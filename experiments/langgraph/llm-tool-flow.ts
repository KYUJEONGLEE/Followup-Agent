import "dotenv/config";
import OpenAI from "openai";
import {
    END,
    START,
    GraphNode,
    StateGraph,
    StateSchema,
} from "@langchain/langgraph";
import { z } from "zod/v4";

const client = new OpenAI();
const model = "gpt-5.6";
const instructions =
    "사용자 요청에 정확히 답하기 위해 필요한 경우에만 제공된 Tool을 사용하세요. Tool 결과가 없으면 고객 정보를 추측하거나 만들어내지 마세요. Tool 결과를 받으면 그 결과를 바탕으로 간결하게 답하세요.";

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

const PendingToolCall = z.object({
    callId: z.string(),
    name: z.string(),
    arguments: z.string(),
});

const AgentState = new StateSchema({
    userMessage: z.string(),
    previousResponseId: z.string().nullable().default(null),
    pendingToolCall: PendingToolCall.nullable().default(null),
    toolCallId: z.string().nullable().default(null),
    toolOutput: z.string().nullable().default(null),
    finalAnswer: z.string().default(""),
    trace: z.array(z.string()).default([]),
});

const callLlm: GraphNode<typeof AgentState> = async (state) => {
    const response = state.previousResponseId
        ? await client.responses.create({
              model,
              previous_response_id: state.previousResponseId,
              instructions,
              input: [
                  {
                      type: "function_call_output",
                      call_id: state.toolCallId!,
                      output: state.toolOutput!,
                  },
              ],
              tools,
              parallel_tool_calls: false,
          })
        : await client.responses.create({
              model,
              instructions,
              input: state.userMessage,
              tools,
              parallel_tool_calls: false,
          });

    const functionCall = response.output.find(
        (item) => item.type === "function_call"
    );

    if (!functionCall) {
        return {
            previousResponseId: response.id,
            pendingToolCall: null,
            finalAnswer: response.output_text,
            trace: [...state.trace, "call_llm:final_answer"],
        };
    }

    return {
        previousResponseId: response.id,
        pendingToolCall: {
            callId: functionCall.call_id,
            name: functionCall.name,
            arguments: functionCall.arguments,
        },
        trace: [...state.trace, `call_llm:function_call:${functionCall.name}`],
    };
};

const executeTool: GraphNode<typeof AgentState> = (state) => {
    const toolCall = state.pendingToolCall;

    if (!toolCall || toolCall.name !== "get_customer") {
        throw new Error("실행할 get_customer Tool 호출이 없습니다.");
    }

    const args = JSON.parse(toolCall.arguments) as { name: string };
    const customer = getCustomer(args.name);

    return {
        pendingToolCall: null,
        toolCallId: toolCall.callId,
        toolOutput: JSON.stringify({
            success: true,
            data: customer,
        }),
        trace: [...state.trace, `execute_tool:get_customer(${args.name})`],
    };
};

const graph = new StateGraph(AgentState)
    .addNode("call_llm", callLlm)
    .addNode("execute_tool", executeTool)
    .addEdge(START, "call_llm")
    .addConditionalEdges("call_llm", (state) =>
        state.pendingToolCall ? "execute_tool" : END
    )
    .addEdge("execute_tool", "call_llm")
    .compile();

async function runCase(title: string, userMessage: string) {
    const result = await graph.invoke({ userMessage });

    console.log(`\n[${title}]`);
    console.log("최종 답변:", result.finalAnswer);
    console.log("실행 경로:", result.trace);
}

async function main() {
    await runCase("고객 조회", "김민수 고객 정보를 알려줘.");
    await runCase("Tool 미사용", "안녕하세요.");
}

main().catch(console.error);
