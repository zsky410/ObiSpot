import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { TabHeaderLogo } from "../../src/components/TabHeaderLogo";
import {
  ApiRequestError,
  getChatbotSessionApi,
  queryChatbotApi,
  type ChatbotHistoryItem,
  type ChatbotReply,
  type ChatbotSessionMessage
} from "../../src/lib/api";
import { useAuth } from "../../src/store/auth";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: ChatbotReply["source"];
  pending?: boolean;
};

function buildMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapSessionMessage(item: ChatbotSessionMessage): ChatMessage {
  return {
    id: item.id,
    role: item.role,
    text: item.text,
    source: item.source
  };
}

export default function ChatScreen() {
  const { bootstrapped, getValidAccessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isHydratingSession, setIsHydratingSession] = useState(false);
  const [hasHydratedSession, setHasHydratedSession] = useState(false);

  function scrollToLatest(animated = true) {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = Keyboard.addListener(showEvent, () => {
      scrollToLatest(false);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      scrollToLatest(false);
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function hydrateSession() {
      if (!bootstrapped || hasHydratedSession) {
        return;
      }

      setIsHydratingSession(true);
      try {
        const token = await getValidAccessToken();
        if (!token || !alive) {
          return;
        }

        const response = await getChatbotSessionApi(token);
        if (!alive) {
          return;
        }

        setSessionId(response.sessionId || null);
        setMessages((response.items || []).map(mapSessionMessage));
      } catch (error) {
        console.error("Failed to hydrate chatbot session:", error);
      } finally {
        if (alive) {
          setIsHydratingSession(false);
          setHasHydratedSession(true);
          scrollToLatest(false);
        }
      }
    }

    void hydrateSession();

    return () => {
      alive = false;
    };
  }, [bootstrapped, getValidAccessToken, hasHydratedSession]);

  async function sendMessage() {
    const nextMessage = inputValue.trim();
    if (!nextMessage || isSending || isHydratingSession) {
      return;
    }

    const history: ChatbotHistoryItem[] = messages
      .filter((item) => !item.pending)
      .slice(-8)
      .map((item) => ({
        role: item.role,
        text: item.text
      }));
    const userMessageId = buildMessageId("user");
    const pendingMessageId = buildMessageId("assistant");

    setInputValue("");
    setIsSending(true);
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: "user", text: nextMessage },
      { id: pendingMessageId, role: "assistant", text: "Đang kiểm tra lịch sân cho bạn...", pending: true }
    ]);

    try {
      const token = await getValidAccessToken();
      if (!token) {
        throw new Error("Phiên đăng nhập đã hết. Bạn vui lòng đăng nhập lại để dùng trợ lý AI.");
      }

      const response = await queryChatbotApi(token, nextMessage, {
        sessionId,
        history
      });
      setSessionId(response.sessionId || sessionId);
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingMessageId
            ? {
                id: pendingMessageId,
                role: "assistant",
                text: response.reply,
                source: response.source
              }
            : item
        )
      );
    } catch (error) {
      const fallbackText =
        error instanceof ApiRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Không gửi được tin nhắn. Bạn thử lại giúp mình.";

      setMessages((current) =>
        current.map((item) =>
          item.id === pendingMessageId
            ? {
                id: pendingMessageId,
                role: "assistant",
                text: fallbackText,
                source: "fallback"
              }
            : item
        )
      );
    } finally {
      setIsSending(false);
      scrollToLatest();
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : Math.max(insets.bottom, 8)}
      >
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <TabHeaderLogo />
            <Ionicons name="chatbubble-ellipses-outline" size={22} color="#6C7A71" />
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
            onContentSizeChange={() => scrollToLatest()}
            renderItem={({ item }) => {
              const isUser = item.role === "user";
              return (
                <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
                  <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
                    {!isUser && (
                      <View style={styles.authorRow}>
                        <Text style={styles.messageAuthor}>ObiSpot AI</Text>
                      </View>
                    )}

                    {item.pending ? (
                      <View style={styles.pendingRow}>
                        <ActivityIndicator size="small" color="#136F63" />
                        <Text style={styles.pendingText}>{item.text}</Text>
                      </View>
                    ) : (
                      <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.assistantMessageText]}>
                        {item.text}
                      </Text>
                    )}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              isHydratingSession ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color="#136F63" />
                  <Text style={styles.emptyText}>Đang tải phiên trò chuyện gần nhất...</Text>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="chatbox-ellipses-outline" size={28} color="#97A5B2" />
                  <Text style={styles.emptyTitle}>Bắt đầu cuộc trò chuyện</Text>
                  <Text style={styles.emptyText}>Nhập câu hỏi để kiểm tra lịch sân hoặc giá sân.</Text>
                </View>
              )
            }
          />

          <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            {!bootstrapped && (
              <View style={styles.bootingRow}>
                <ActivityIndicator size="small" color="#136F63" />
                <Text style={styles.bootingText}>Đang khởi tạo phiên đăng nhập...</Text>
              </View>
            )}

            <View style={styles.composerRow}>
              <TextInput
                style={styles.input}
                placeholder="Nhập câu hỏi về lịch sân"
                placeholderTextColor="#7B8B97"
                value={inputValue}
                onChangeText={setInputValue}
                multiline
                editable={!isSending && bootstrapped && !isHydratingSession}
              />
              <Pressable
                style={[
                  styles.sendButton,
                  (!inputValue.trim() || isSending || !bootstrapped || isHydratingSession) && styles.sendButtonDisabled
                ]}
                onPress={() => void sendMessage()}
                disabled={!inputValue.trim() || isSending || !bootstrapped || isHydratingSession}
              >
                <Ionicons name="paper-plane" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6FB" },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 14, paddingTop: 10, gap: 12 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  messagesList: { flex: 1 },
  messagesContent: { flexGrow: 1, paddingBottom: 18, gap: 10 },
  messageRow: { width: "100%" },
  messageRowUser: { alignItems: "flex-end" },
  messageRowAssistant: { alignItems: "flex-start" },
  messageBubble: {
    maxWidth: "88%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  userBubble: {
    backgroundColor: "#136F63",
    borderBottomRightRadius: 6
  },
  assistantBubble: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E1EC",
    borderBottomLeftRadius: 6
  },
  messageAuthor: {
    fontSize: 12,
    fontWeight: "800",
    color: "#294357"
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6
  },
  messageText: {
    fontSize: 14,
    lineHeight: 21
  },
  userMessageText: { color: "#FFFFFF" },
  assistantMessageText: { color: "#213547" },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  pendingText: { color: "#2B4357", lineHeight: 20, flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#213547"
  },
  emptyText: {
    textAlign: "center",
    color: "#6C7A71",
    fontSize: 14,
    lineHeight: 21
  },
  composerWrap: {
    paddingTop: 4,
    gap: 8
  },
  bootingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2
  },
  bootingText: { color: "#5B6574", fontSize: 12 },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E1EC",
    borderRadius: 18,
    padding: 10
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    color: "#102033",
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 6
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#136F63",
    alignItems: "center",
    justifyContent: "center"
  },
  sendButtonDisabled: {
    opacity: 0.45
  }
});
