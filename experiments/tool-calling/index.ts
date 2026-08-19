import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI();

async function main() {
    const response = await client.responses.create({
        model: "gpt-5.6",
        input: "안녕하세요. 한 문장으로 인사해주세요.",
    });

    console.log(response.output_text);
}

main();