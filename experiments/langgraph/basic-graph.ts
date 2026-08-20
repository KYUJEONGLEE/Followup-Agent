import {
    StateGraph,
    StateSchema,
    GraphNode,
    START,
    END,
} from "@langchain/langgraph";
import { z } from "zod/v4";

const AgentState = new StateSchema({
    request: z.string(),
    nextAction: z.enum(["lookup_customer", "respond"]).default("respond"),
    customer: z.string().default(""),
    result: z.string().default(""),
    trace: z.array(z.string()).default([]),
});

const decideRequest: GraphNode<typeof AgentState> = (state) => {
    const nextAction = state.request.includes("고객")
        ? "lookup_customer"
        : "respond";

    return {
        nextAction,
        trace: [...state.trace, `decide_request:${nextAction}`],
    };
};

const lookupCustomer: GraphNode<typeof AgentState> = (state) => {
    return {
        customer: "김민수 / VIP 고객",
        trace: [...state.trace, "lookup_customer"],
    };
};

const respond: GraphNode<typeof AgentState> = (state) => {
    const result = state.customer
        ? `조회 결과: ${state.customer}`
        : `도구 호출 없이 처리한 요청: ${state.request}`;

    return {
        result,
        trace: [...state.trace, "respond"],
    };
};

const graph = new StateGraph(AgentState)
    .addNode("decide_request", decideRequest)
    .addNode("lookup_customer", lookupCustomer)
    .addNode("respond", respond)
    .addEdge(START, "decide_request")
    .addConditionalEdges("decide_request", (state) => state.nextAction)
    .addEdge("lookup_customer", "respond")
    .addEdge("respond", END)
    .compile();

async function main() {
    const toolResult = await graph.invoke({
        request: "김민수 고객 정보를 조회해줘.",
    });

    const noToolResult = await graph.invoke({
        request: "오늘 업무 우선순위를 정리해줘.",
    });

    console.log("Tool 호출 경로 최종 State:");
    console.log(toolResult);
    console.log("\nTool 미호출 경로 최종 State:");
    console.log(noToolResult);
}

main().catch(console.error);
