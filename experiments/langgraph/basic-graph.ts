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
    result: z.string().default(""),
});

const processRequest: GraphNode<typeof AgentState> = (state) => {
    console.log("Node에서 받은 State:", state);

    return {
        result: `처리한 요청: ${state.request}`,
    };
};

const graph = new StateGraph(AgentState)
    .addNode("process_request", processRequest)
    .addEdge(START, "process_request")
    .addEdge("process_request", END)
    .compile();

async function main() {
    const result = await graph.invoke({
        request: "김민수 고객 정보를 조회해줘.",
    });

    console.log("\n최종 State:");
    console.log(result);
}

main().catch(console.error);