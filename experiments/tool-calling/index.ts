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
    ];

    // 1. 사용자 요청 → 모델이 Tool 호출 결정
    const response = await client.responses.create({
        model: "gpt-5.6",
        input: "김민수 고객 정보를 알려줘.",
        tools,
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

    console.log("최종 응답:", finalResponse.output_text);
}

main();