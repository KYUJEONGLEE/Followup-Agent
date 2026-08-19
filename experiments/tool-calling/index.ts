import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI();

async function main() {
    const response = await client.responses.create({
        model: "gpt-5.6",

        input: "김민수 고객 정보를 알려줘.",

        tools: [
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
        ],
    });

    console.dir(response.output, {
        depth: null,
    });
}

main();