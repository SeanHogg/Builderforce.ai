import Foundation
import Testing
@testable import BuilderforceKit

private func json(_ data: Data?) throws -> [String: Any] {
    let object = try JSONSerialization.jsonObject(with: data ?? Data())
    return try #require(object as? [String: Any])
}

@Suite struct BrainChatAPITests {
    @Test func listAndMessagesRequestsUseTheSynapsePaths() {
        #expect(BrainChatAPI.listChatsRequest() == CloudAPIRequest(method: "GET", path: "/api/brain/chats?limit=50"))
        #expect(BrainChatAPI.messagesRequest(chatID: 12) == CloudAPIRequest(
            method: "GET",
            path: "/api/brain/chats/12/messages?limit=100"))
        #expect(BrainChatAPI.agentsRequest(chatID: 12).path == "/api/brain/chats/12/agents")
    }

    @Test func createChatSendsATrimmedTitleOrNone() throws {
        let titled = try BrainChatAPI.createChatRequest(title: "  Launch  ")
        #expect(titled.method == "POST")
        #expect(titled.path == "/api/brain/chats")
        #expect(try json(titled.body)["title"] as? String == "Launch")

        let untitled = try BrainChatAPI.createChatRequest(title: "   ")
        #expect(try json(untitled.body)["title"] == nil)
    }

    @Test func aTurnToTheBrainCarriesNoMetadata() throws {
        let request = try BrainChatAPI.sendRequest(chatID: 4, content: "Hello", to: nil, attachments: [])
        #expect(request.path == "/api/brain/chats/4/messages")
        let messages = try #require(try json(request.body)["messages"] as? [[String: Any]])
        #expect(messages.count == 1)
        #expect(messages[0]["role"] as? String == "user")
        #expect(messages[0]["content"] as? String == "Hello")
        #expect(messages[0]["metadata"] == nil)
    }

    @Test func aTurnToAnAgentIsAddressedInItsMetadataText() throws {
        let agent = BrainChatAgent(id: "as-1", agentRef: "77", name: "Ada")
        let file = BrainChatAttachment(key: "t/1/a.png", name: "a.png", type: "image/png")
        let request = try BrainChatAPI.sendRequest(chatID: 4, content: "Take it", to: agent, attachments: [file])
        let messages = try #require(try json(request.body)["messages"] as? [[String: Any]])
        let metadataText = try #require(messages[0]["metadata"] as? String)
        let metadata = try json(Data(metadataText.utf8))
        let addressed = try #require(metadata["addressedTo"] as? [String: Any])
        #expect(addressed["kind"] as? String == "agent")
        #expect(addressed["ref"] as? String == "77")
        #expect(addressed["name"] as? String == "Ada")
        let attachments = try #require(metadata["attachments"] as? [[String: Any]])
        #expect(attachments.first?["key"] as? String == "t/1/a.png")
    }

    @Test func theAssistantAnswerIsPersistedAsAnAssistantTurn() throws {
        let request = try BrainChatAPI.appendAssistantRequest(chatID: 9, content: "Done")
        let messages = try #require(try json(request.body)["messages"] as? [[String: Any]])
        #expect(messages[0]["role"] as? String == "assistant")
    }

    @Test func decodesChatsMessagesInSeqOrderAndAgentsWithNumericIds() throws {
        let chats = try BrainChatAPI.decodeChats(Data(#"""
        {"chats":[{"id":3,"title":null,"projectId":null,"createdAt":"2026-10-01T10:00:00.000Z","updatedAt":"2026-10-02T10:00:00.000Z"}]}
        """#.utf8))
        #expect(chats == [BrainChat(id: 3, title: nil, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z")])

        let messages = try BrainChatAPI.decodeMessages(Data(#"""
        {"messages":[
          {"id":11,"role":"assistant","content":"Hi","metadata":"{\"authoredBy\":{\"name\":\"Ada\"}}","seq":2,"createdAt":"2026-10-01T10:00:01.000Z"},
          {"id":10,"role":"user","content":"Hello","metadata":"{\"addressedTo\":{\"kind\":\"agent\",\"ref\":7,\"name\":\"Ada\"}}","seq":1,"createdAt":"2026-10-01T10:00:00.000Z"}
        ]}
        """#.utf8))
        #expect(messages.map(\.id) == [10, 11])
        #expect(messages[1].authorName == "Ada")
        #expect(messages[0].addressedAgentRef == "7")

        let agents = try BrainChatAPI.decodeAgents(Data(#"""
        {"agents":[{"id":5,"agentKind":"workforce","agentRef":12,"name":"","role":"participant"}]}
        """#.utf8))
        #expect(agents == [BrainChatAgent(id: "5", agentRef: "12", agentKind: "workforce", name: "12", role: "participant")])
    }

    @Test func aFailedAnswerKeepsThePlatformMessageAndReason() {
        let error = CloudError.fromStatus(402, body: Data(#"{"error":"Out of tokens","code":"insufficient_tokens"}"#.utf8))
        #expect(error == .status(code: 402, message: "Out of tokens", reason: "insufficient_tokens"))
    }

    @Test func theConfigReadsTheOverrideAndDerivesTheWebOrigin() {
        #expect(CloudConfig.gatewayBase(environment: [:]) == "https://builderforce.ai/gateway")
        #expect(CloudConfig.gatewayBase(environment: ["BUILDERFORCE_URL": "http://localhost:8787/gateway/"])
            == "http://localhost:8787/gateway")
        #expect(CloudConfig(gatewayBase: "https://api.builderforce.ai", client: "ios").webBase == "https://builderforce.ai")
        #expect(CloudConfig(gatewayBase: "https://builderforce.ai/gateway", client: "ios").apiURL("/api/brain/chats")?
            .absoluteString == "https://builderforce.ai/gateway/api/brain/chats")
    }
}

@Suite struct CompletionStreamTests {
    @Test func textArrivesPieceByPiece() throws {
        var accumulator = CompletionAccumulator()
        var shown = ""
        for line in [
            #"data: {"choices":[{"delta":{"content":"Hel"}}]}"#,
            "",
            #"data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}"#,
            "data: [DONE]",
        ] {
            if let piece = try accumulator.feed(line: line) {
                shown += piece
            }
        }
        let turn = accumulator.finish()
        #expect(shown == "Hello")
        #expect(turn.text == "Hello")
        #expect(turn.finishReason == "stop")
        #expect(turn.toolCalls.isEmpty)
        #expect(accumulator.isDone)
    }

    @Test func toolCallFragmentsAreStitchedByIndex() throws {
        var accumulator = CompletionAccumulator()
        for line in [
            #"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"builtin_tasks_list","arguments":"{\"pro"}}]}}]}"#,
            #"data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"builtin_projects_list","arguments":"{}"}}]}}]}"#,
            #"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"jectId\":7}"}}]}}]}"#,
        ] {
            _ = try accumulator.feed(line: line)
        }
        let turn = accumulator.finish()
        #expect(turn.toolCalls == [
            CompletionToolCall(id: "c1", name: "builtin_tasks_list", arguments: #"{"projectId":7}"#),
            CompletionToolCall(id: "c2", name: "builtin_projects_list", arguments: "{}"),
        ])
    }

    @Test func aFailureMidStreamThrowsAndJunkIsSkipped() throws {
        var accumulator = CompletionAccumulator()
        #expect(try accumulator.feed(line: "data: {not json") == nil)
        #expect(try accumulator.feed(line: ": keep-alive") == nil)
        #expect(throws: CloudError.self) {
            try accumulator.feed(line: #"data: {"error":{"message":"overloaded"}}"#)
        }
    }

    @Test func aWholeBodyReadsLikeAStream() {
        var accumulator = CompletionAccumulator()
        accumulator.feed(body: Data(#"""
        {"choices":[{"message":{"content":"","tool_calls":[{"function":{"name":"builtin_tasks_create","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}
        """#.utf8))
        let turn = accumulator.finish()
        #expect(turn.toolCalls.first?.id == "call_0")
        #expect(turn.finishReason == "tool_calls")
    }

    @Test func theConversationNamesOtherAuthorsAndCarriesImagesOnTheLatestQuestion() throws {
        let messages = [
            BrainChatMessage(id: 1, role: "user", content: "Plan the launch"),
            BrainChatMessage(id: 2, role: "assistant", content: "On it", metadata: #"{"authoredBy":{"name":"Ada"}}"#),
            BrainChatMessage(id: 3, role: "tool", content: "ignored"),
            BrainChatMessage(id: 4, role: "user", content: "  What is left?  "),
        ]
        let convo = BrainReplyRunner.conversation(messages, imageURLs: ["data:image/jpeg;base64,AAAA"])
        #expect(convo.map(\.role) == ["user", "assistant", "user"])
        let encoded = try JSONSerialization.jsonObject(with: CloudJSON.encode(convo)) as? [[String: Any]]
        #expect(encoded?[1]["content"] as? String == "[Ada] On it")
        let parts = try #require(encoded?[2]["content"] as? [[String: Any]])
        #expect(parts.first?["text"] as? String == "What is left?")
        #expect((parts.last?["image_url"] as? [String: Any])?["url"] as? String == "data:image/jpeg;base64,AAAA")
    }

    @Test func toolsReadAsWhatTheyDoAndUndeclaredOnesCountAsWriting() throws {
        #expect(PlatformTool.label(for: "builtin_tasks_create") == "tasks create")
        let tools = try JSONDecoder().decode([PlatformTool].self, from: Data(#"""
        [{"extensionId":"builtin","tool":"tasks.list","name":"builtin_tasks_list","description":"List","parameters":{"type":"object"},"mutates":false},
         {"extensionId":"x1","tool":"send","name":"x1_send"}]
        """#.utf8))
        #expect(!tools[0].writes)
        #expect(tools[1].writes)
        #expect(BrainReplyRunner.argumentObject("") != nil)
        #expect(BrainReplyRunner.argumentObject("[1]") == nil)
    }
}
