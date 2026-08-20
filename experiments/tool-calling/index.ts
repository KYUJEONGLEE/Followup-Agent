import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI();

function getCustomer(name: string) {
    const customers = [
        {
            id: "C001",
            name: "김민수",
            lastVisitAt: "2026-08-01",
            status: "active",
        },
    ];

    return customers.find((customer) => customer.name === name) ?? null;
}

function getConsultations(customerId: string) {
    const consultations = {
        C001: [
            {
                id: "CONS001",
                date: "2026-08-01",
                summary: "다음 상담 전 생활 습관 확인 필요",
            },
            {
                id: "CONS002",
                date: "2026-07-15",
                summary: "최근 상태 변화 확인",
            },
        ],
    };

    return consultations[customerId as keyof typeof consultations] ?? [];
}

const tools: OpenAI.Responses.Tool[] = [
    {
        type: "function",
        name: "get_customer",
        description: "고객 이름으로 고객 정보를 조회합니다.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "조회할 고객의 이름",
                },
            },
            required: ["name"],
            additionalProperties: false,
        },
        strict: true,
    },
    {
        type: "function",
        name: "get_consultations",
        description:
            "고객 ID로 상담 이력을 조회합니다. 고객 ID를 모르면 먼저 get_customer를 사용합니다.",
        parameters: {
            type: "object",
            properties: {
                customer_id: {
                    type: "string",
                    description: "조회할 고객 ID",
                },
            },
            required: ["customer_id"],
            additionalProperties: false,
        },
        strict: true,
    },
];

function executeTool(name: string, args: any) {
    switch (name) {
        case "get_customer":
            return getCustomer(args.name);

        case "get_consultations":
            return getConsultations(args.customer_id);

        default:
            throw new Error(`지원하지 않는 Tool: ${name}`);
    }
}

async function main() {
    let response = await client.responses.create({
        model: "gpt-5.6",
        input: "박철수 고객의 기본 정보와 최근 상담 내용을 알려줘.",
        tools,
        parallel_tool_calls: false,
    });

    while (true) {
        const toolCalls = response.output.filter(
            (item) => item.type === "function_call"
        );

        // 더 이상 Tool 호출이 없으면 최종 답변
        if (toolCalls.length === 0) {
            console.log("\n최종 응답:");
            console.log(response.output_text);
            break;
        }

        const toolOutputs = toolCalls.map((toolCall) => {
            const args = JSON.parse(toolCall.arguments);

            console.log(`\nTool 호출: ${toolCall.name}`);
            console.log("Arguments:", args);

            try {
                const result = executeTool(toolCall.name, args);

                console.log("실행 결과:", result);

                return {
                    type: "function_call_output" as const,
                    call_id: toolCall.call_id,
                    output: JSON.stringify({
                        success: true,
                        data: result,
                    }),
                };
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "알 수 없는 Tool 실행 오류";

                console.log("Tool 실행 실패:", message);

                return {
                    type: "function_call_output" as const,
                    call_id: toolCall.call_id,
                    output: JSON.stringify({
                        success: false,
                        error: {
                            code: "TOOL_EXECUTION_FAILED",
                            message,
                        },
                    }),
                };
            }
        });

        response = await client.responses.create({
            model: "gpt-5.6",
            previous_response_id: response.id,
            input: toolOutputs,
            tools,
            parallel_tool_calls: false,
        });
    }
}

main();