import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI();

function getCustomer(name: string) {
    return {
        id: "C001",
        name,
        lastVisitAt: "2026-08-01",
        status: "active",
    };
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

async function main() {
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
                "고객 ID를 사용해 해당 고객의 상담 이력을 조회합니다. 고객 ID를 모르는 경우 먼저 get_customer를 사용해야 합니다.",
            parameters: {
                type: "object",
                properties: {
                    customer_id: {
                        type: "string",
                        description: "get_customer로 조회한 고객 ID",
                    },
                },
                required: ["customer_id"],
                additionalProperties: false,
            },
            strict: true,
        },
    ];

    // 1. 사용자 요청 → 모델이 Tool 호출 결정
    const response = await client.responses.create({
        model: "gpt-5.6",
        input: "김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘.",
        tools,
        parallel_tool_calls: false,
    });

    console.dir(response.output, {
        depth: null,
    });

    // 2. Tool Call 찾기
    const toolCall = response.output.find(
        (item) => item.type === "function_call"
    );

    if (!toolCall) {
        console.log("Tool 호출 없음");
        return;
    }

    const args = JSON.parse(toolCall.arguments);

    console.log("LLM이 요청한 Tool:", toolCall.name);
    console.log("Tool Arguments:", args);

    // 3. 실제 Backend 함수 실행
    const result = getCustomer(args.name);

    console.log("Tool 실행 결과:", result);

    // 4. Tool 결과를 이전 응답에 이어서 모델에게 전달
    const finalResponse = await client.responses.create({
        model: "gpt-5.6",
        previous_response_id: response.id,
        tools,
        input: [
            {
                type: "function_call_output",
                call_id: toolCall.call_id,
                output: JSON.stringify(result),
            },
        ],
    });

    console.dir(finalResponse.output, {
        depth: null,
    });
    
    console.log("최종 응답:", finalResponse.output_text);
}

main();