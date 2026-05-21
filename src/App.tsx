import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Bot,
  Send,
  User,
  Menu,
  Settings,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  TextQuote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// Firebase imports
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/src/lib/firebase";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Add motion for animations
import { motion, AnimatePresence } from "motion/react";

// SET THIS to your Cloudflare Worker URL once deployed
const WORKER_URL = "https://testbotworker.jcruspero3263.workers.dev"; // e.g., https://seatalk-bot-webhook.username.workers.dev

export default function App() {
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {activeTab === "chat" && <ChatInterface />}
        {activeTab === "rules" && <AutoReplyRules />}
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "settings" && <SettingsPanel />}
      </main>
      <Toaster />
    </div>
  );
}

function Sidebar({
  activeTab,
  setActiveTab,
}: {
  activeTab: string;
  setActiveTab: (v: string) => void;
}) {
  return (
    <div className="w-16 md:w-64 bg-white border-r border-neutral-200 flex flex-col items-center md:items-stretch py-4 transition-all overflow-hidden shrink-0">
      <div className="px-4 mb-8 hidden md:flex items-center gap-2">
        <div className="bg-blue-600 p-1.5 rounded-lg text-white">
          <Bot size={20} />
        </div>
        <h1 className="font-bold text-lg text-neutral-900 tracking-tight">
          SeaTalk Manager
        </h1>
      </div>
      <div className="px-0 md:px-3 flex-1 flex flex-col gap-2">
        <NavButton
          icon={<MessageSquare size={20} />}
          label="Conversations"
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        />
        <NavButton
          icon={<Bot size={20} />}
          label="Auto Replies"
          active={activeTab === "rules"}
          onClick={() => setActiveTab("rules")}
        />
        <NavButton
          icon={<CheckCircle2 size={20} />}
          label="Logs"
          active={activeTab === "logs"}
          onClick={() => setActiveTab("logs")}
        />
        <NavButton
          icon={<Settings size={20} />}
          label="Setup Guide"
          active={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
        />
      </div>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex justify-center md:justify-start items-center gap-3 p-3 md:px-4 rounded-xl transition-all w-full",
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
      )}
    >
      {icon}
      <span className="hidden md:block whitespace-nowrap">{label}</span>
    </button>
  );
}

// --- Chat Interface ---
function ChatInterface() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchContacts = async () => {
    try {
      const res = await fetch(
        `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/contacts`,
      );
      if (res.ok) {
        const data = await res.json();
        const employees = (data.employees || []).map((emp: any) => {
          if (emp.employee_code === "e_ptv9p1zy") {
            return {
              ...emp,
              email: "segagt505@shopeemobile-external.com",
              name: "Segagt 505",
            };
          }
          return emp;
        });
        setContacts([...(data.groups || []), ...employees]);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  // Listen to Firestore conversations
  useEffect(() => {
    try {
      const q = query(
        collection(db, "conversations"),
        orderBy("last_message_time", "desc"),
      );
      const unsub = onSnapshot(q, (snap) => {
        const convs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setConversations(convs);
        if (!activeConvId && convs.length > 0) {
          setActiveConvId(convs[0].id);
        }
      });
      return () => unsub();
    } catch (e) {
      console.log("Firebase not configured yet");
    }
  }, []);

  // Listen to Firestore messages
  useEffect(() => {
    if (!activeConvId) return;
    try {
      const q = query(collection(db, "messages"), orderBy("sent_at", "asc"));
      const unsub = onSnapshot(q, (snap) => {
        const msgs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m: any) => m.conversation_id === activeConvId);
        setMessages(msgs);
        setTimeout(() => {
          if (scrollRef.current)
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);

        // Reset unread count
        updateDoc(doc(db, "conversations", activeConvId), {
          unread_count: 0,
        }).catch(() => {});
      });
      setLoading(false);
      return () => unsub();
    } catch (e) {}
  }, [activeConvId]);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertFormat = (prefix: string, suffix: string = "") => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    let newText = "";
    let newCursorPosition = start;

    if (selected) {
      newText = before + prefix + selected + suffix + after;
      newCursorPosition =
        start + prefix.length + selected.length + suffix.length;
    } else {
      newText = before + prefix + suffix + after;
      newCursorPosition = start + prefix.length;
    }

    setInput(newText);

    // Focus and set cursor position after React re-renders
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    }, 0);
  };

  const getDisplayName = (c: any) => {
    if (c.chat_type === "group") {
      const groupContact = contacts.find((co) => co.id === c.group_id);
      return c.group_name || groupContact?.name || "Group Chat";
    }
    const contact = contacts.find((co) => co.employee_code === c.employee_code);
    if (contact?.email && !contact.email.endsWith("@seatalk.biz")) {
      return contact.email;
    }
    if (c.user_email && !c.user_email.endsWith("@seatalk.biz")) {
      return c.user_email;
    }
    return contact?.email || c.user_email || (c.employee_code ? `${c.employee_code}@seatalk.biz` : "Unknown User");
  };

  const getDisplaySubName = (c: any) => {
    if (c.chat_type === "group") return "Group Chat";
    const contact = contacts.find((co) => co.employee_code === c.employee_code);
    if (contact?.email && !contact.email.endsWith("@seatalk.biz")) {
      return contact.email;
    }
    if (c.user_email && !c.user_email.endsWith("@seatalk.biz")) {
      return c.user_email;
    }
    return contact?.email || c.user_email || (c.employee_code ? `${c.employee_code}@seatalk.biz` : "Private Chat");
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeConvId || !activeConv) return;
    const txt = input;
    setInput("");
    try {
      if (WORKER_URL.startsWith("http")) {
        const contact = contacts.find((co) => co.employee_code === activeConv.employee_code);
        const resolvedEmail = (contact?.email && !contact.email.endsWith("@seatalk.biz")) 
          ? contact.email 
          : (activeConv.user_email && !activeConv.user_email.endsWith("@seatalk.biz"))
          ? activeConv.user_email
          : contact?.email || activeConv.user_email || "";
        const resolvedName = (contact?.name && !contact.name.startsWith("e_")) 
          ? contact.name 
          : activeConv.user_name || contact?.name || "";

        const res = await fetch(
          `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversation_id: activeConvId,
              chat_type: activeConv.chat_type,
              target_id:
                activeConv.chat_type === "private"
                  ? activeConv.employee_code
                  : activeConv.group_id,
              content: txt,
              user_name: resolvedName,
              user_email: resolvedEmail,
              group_name: activeConv.group_name || "",
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text);
        }
        const data = await res.json();
        if (data.conversation_id && data.conversation_id !== activeConvId) {
          setActiveConvId(data.conversation_id);
        }
      } else {
        toast.info(
          "Message saved locally. Deploy your worker to send it to SeaTalk!",
        );
      }
    } catch (e) {
      toast.error("Failed to send message: " + e);
    }
  };

  return (
    <div className="flex h-full bg-white relative">
      <div
        className={cn(
          "w-full md:w-80 border-r border-neutral-200 flex flex-col absolute md:static inset-0 bg-white z-10 transition-transform",
          activeConvId ? "-translate-x-full md:translate-x-0" : "translate-x-0",
        )}
      >
        <div className="p-4 border-b border-neutral-100 pb-4 flex justify-between items-center shrink-0">
          <h2 className="font-semibold text-lg">Inbox</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsNewChatOpen(true);
              fetchContacts();
            }}
          >
            <MessageSquare size={18} />
          </Button>
        </div>

        <Dialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Conversation</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-neutral-500 mb-4">
                Select a known user or group from your connected bot
                interactions.
              </p>
              <Input
                placeholder="Search name, email, or ID..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="mb-2"
              />
              <ScrollArea className="h-[300px] border rounded-md p-2">
                {contacts.length === 0 ? (
                  <div className="text-center p-8 text-neutral-400 text-sm">
                    No contacts found. Have users interact with the bot first or
                    join a group.
                  </div>
                ) : (
                  contacts
                    .filter(
                      (c) =>
                        (c.name || "")
                          .toLowerCase()
                          .includes(contactSearch.toLowerCase()) ||
                        (c.email || "")
                          .toLowerCase()
                          .includes(contactSearch.toLowerCase()) ||
                        (c.employee_code || c.id || "")
                          .toLowerCase()
                          .includes(contactSearch.toLowerCase()),
                    )
                    .map((c, i) => (
                      <button
                        key={i}
                        className="w-full text-left p-3 hover:bg-neutral-50 border-b last:border-0 rounded-sm mb-1 transition-colors flex items-center justify-between"
                        onClick={() => {
                          // Instead of calling worker just to make a conversation,
                          // we can just pretend it's active. Let's create a local mock until user sends a message.
                          // Wait, we need a conversation ID.
                          const newConvId = "new_" + Date.now();
                          setConversations([
                            {
                              id: newConvId,
                              chat_type: c.type,
                              employee_code: c.employee_code || "",
                              user_name: c.name || "",
                              user_email: c.email || "",
                              group_id: c.id || "",
                              group_name: c.name || "",
                              last_message: "",
                              last_message_time: new Date().toISOString(),
                              unread_count: 0,
                            },
                            ...conversations,
                          ]);
                          setActiveConvId(newConvId);
                          setIsNewChatOpen(false);
                        }}
                      >
                        <div>
                          <div className="font-medium">
                            {c.type === "group"
                              ? c.name || c.id
                              : c.email || (c.employee_code ? `${c.employee_code}@seatalk.biz` : c.name) || "Unknown User"}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {c.type === "group" ? "Group Chat" : "Private Chat"}
                          </div>
                        </div>
                        <Badge variant="secondary">{c.type}</Badge>
                      </button>
                    ))
                )}
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>

        <ScrollArea className="flex-1">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              className={cn(
                "w-full text-left p-4 hover:bg-neutral-50 border-b border-neutral-100 transition-colors",
                activeConvId === c.id ? "bg-blue-50/50" : "",
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium text-neutral-900 truncate">
                  {getDisplayName(c)}
                </span>
                {c.unread_count > 0 && (
                  <Badge
                    variant="default"
                    className="bg-blue-600 rounded-full w-5 h-5 flex items-center justify-center p-0 text-[10px]"
                  >
                    {c.unread_count}
                  </Badge>
                )}
              </div>
              <div className="text-sm text-neutral-500 flex justify-between gap-2">
                <span className="truncate">
                  {c.last_message || "Started chat"}
                </span>
                <span className="text-xs whitespace-nowrap shrink-0">
                  {new Date(c.last_message_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </button>
          ))}
          {conversations.length === 0 && (
            <div className="text-center p-8 text-neutral-400 text-sm">
              No conversations yet
            </div>
          )}
        </ScrollArea>
      </div>

      <div
        className={cn(
          "flex-1 flex flex-col absolute md:static inset-0 bg-white transition-transform",
          activeConvId ? "translate-x-0" : "translate-x-full md:translate-x-0",
        )}
      >
        {activeConv ? (
          <>
            <div className="h-16 px-4 border-b border-neutral-200 flex flex-row items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  className="md:hidden p-2 -ml-2 text-neutral-500"
                  onClick={() => setActiveConvId(null)}
                >
                  <Menu />
                </button>
                <div>
                  <h2 className="font-semibold text-neutral-900">
                    {getDisplayName(activeConv)}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {getDisplaySubName(activeConv)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={async () => {
                  if (confirm("Delete this conversation (and all messages)?")) {
                    try {
                      const toDelete = messages.map((m) =>
                        deleteDoc(doc(db, "messages", m.id)),
                      );
                      await Promise.all(toDelete);
                      await deleteDoc(doc(db, "conversations", activeConv.id));
                      setActiveConvId(null);
                      toast.success("Conversation deleted.");
                    } catch (e) {
                      toast.error("Failed to delete: " + e);
                    }
                  }
                }}
              >
                Delete Chat
              </Button>
            </div>

            <div
              className="flex-1 p-4 overflow-y-auto bg-neutral-50/50"
              ref={scrollRef}
            >
              <div className="flex flex-col gap-4 max-w-3xl mx-auto">
                {messages.map((m, i) => {
                  const isMine = m.sender === "admin" || m.sender === "bot";
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col max-w-[75%]",
                        isMine ? "self-end items-end" : "self-start",
                      )}
                    >
                      <span className="text-xs text-neutral-400 mb-1 px-1">
                        {m.sender_name}{" "}
                        {m.is_auto_reply === 1 ? "(Auto-reply)" : ""}
                      </span>
                      <div
                        className={cn(
                          "p-3 rounded-2xl",
                          isMine
                            ? m.sender === "bot"
                              ? "bg-slate-700 text-white rounded-tr-sm"
                              : "bg-blue-600 text-white rounded-tr-sm"
                            : "bg-white border border-neutral-200 text-neutral-900 rounded-tl-sm shadow-sm",
                        )}
                      >
                        <div className="markdown-body whitespace-pre-wrap leading-relaxed [&>p]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-black/10 [&>pre]:p-2 [&>pre]:rounded-md [&_code]:font-mono [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                      <span className="text-[10px] text-neutral-400 mt-1 px-1">
                        {new Date(m.sent_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        {new Date(m.sent_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 bg-white border-t border-neutral-200 shrink-0">
              <div className="max-w-3xl mx-auto flex flex-col gap-2">
                <div
                  className="flex bg-neutral-100 rounded-md p-1 gap-1 items-center w-fit border border-neutral-200"
                  aria-label="Text formatting"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("**", "**")}
                    title="Bold"
                  >
                    <Bold size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("*", "*")}
                    title="Italic"
                  >
                    <Italic size={16} />
                  </Button>
                  <div className="w-px h-4 bg-neutral-300 mx-1"></div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("- ")}
                    title="Bulleted List"
                  >
                    <List size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("1. ")}
                    title="Numbered List"
                  >
                    <ListOrdered size={16} />
                  </Button>
                  <div className="w-px h-4 bg-neutral-300 mx-1"></div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("```\n", "\n```")}
                    title="Code Block"
                  >
                    <Code size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("> ")}
                    title="Quote"
                  >
                    <TextQuote size={16} />
                  </Button>
                </div>
                <div className="flex gap-2 items-end">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a manual reply with Markdown..."
                    className="min-h-[44px] max-h-32 resize-none resize-y rounded-xl"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        (e.key === "b" || e.key === "B")
                      ) {
                        e.preventDefault();
                        insertFormat("**", "**");
                      }
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        (e.key === "i" || e.key === "I")
                      ) {
                        e.preventDefault();
                        insertFormat("*", "*");
                      }
                    }}
                  />
                  <Button
                    onClick={sendMessage}
                    className="h-11 w-11 rounded-full shrink-0 self-end"
                    size="icon"
                  >
                    <Send size={18} className="translate-x-[1px]" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-400 hidden md:flex">
            Select a conversation to start chatting
          </div>
        )}
      </div>
    </div>
  );
}

// --- Auto Reply Rules ---
function AutoReplyRules() {
  const [rules, setRules] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [triggerType, setTriggerType] = useState("keyword");
  const [keywords, setKeywords] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [replyMessage, setReplyMessage] = useState("");
  const [priority, setPriority] = useState("0");

  useEffect(() => {
    try {
      const q = query(collection(db, "rules"), orderBy("priority", "desc"));
      const unsub = onSnapshot(q, (snap) => {
        setRules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });
      return () => unsub();
    } catch (e) {}
  }, []);

  const addRule = async () => {
    try {
      await addDoc(collection(db, "rules"), {
        trigger_type: triggerType,
        keywords:
          triggerType === "keyword"
            ? JSON.stringify(
                keywords
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            : "[]",
        match_type: matchType,
        reply_message: replyMessage,
        is_active: true,
        priority: parseInt(priority) || 0,
      });
      setIsAddOpen(false);
      setKeywords("");
      setReplyMessage("");
      setPriority("0");
      toast.success("Rule added");
    } catch (e) {
      toast.error("Failed to add rule");
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await deleteDoc(doc(db, "rules", id));
      toast.success("Rule deleted");
    } catch (e) {
      toast.error("Failed to delete rule");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-1">
              Auto-Replies
            </h1>
            <p className="text-sm text-neutral-500">
              Configure how the bot automatically responds to incoming messages.
            </p>
          </div>
          <Button className="gap-2" onClick={() => setIsAddOpen(true)}>
            <Plus size={16} /> New Rule
          </Button>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Auto-Reply Rule</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Trigger Type</label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword Match</SelectItem>
                      <SelectItem value="greeting">
                        Greeting (First Time)
                      </SelectItem>
                      <SelectItem value="fallback">
                        Fallback (No Match)
                      </SelectItem>
                      <SelectItem value="bot_added_to_group_chat">
                        Bot Added To Group Chat
                      </SelectItem>
                      <SelectItem value="bot_removed_from_group_chat">
                        Bot Removed From Group Chat
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {triggerType === "keyword" && (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Keywords</label>
                      <Input
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="hello, help, support (comma separated)"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Match Type</label>
                      <Select value={matchType} onValueChange={setMatchType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contains">
                            Contains (Recommended)
                          </SelectItem>
                          <SelectItem value="exact">Exact Match</SelectItem>
                          <SelectItem value="starts_with">
                            Starts With
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    Priority (Higher runs first)
                  </label>
                  <Input
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Reply Message</label>
                  <Textarea
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                    placeholder="Type the automated response..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={addRule} disabled={!replyMessage}>
                  Save Rule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-col gap-4">
          {rules.length === 0 ? (
            <Card className="border-dashed border-2 shadow-none bg-transparent">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Bot className="h-12 w-12 text-neutral-300 mb-4" />
                <h3 className="font-medium text-neutral-900 mb-1">
                  No rules configured
                </h3>
                <p className="text-sm text-neutral-500 mb-4">
                  Set up greeting, fallback, or keyword-based replies to start
                  engaging users automatically.
                </p>
                <Button variant="outline" onClick={() => setIsAddOpen(true)}>
                  Create your first rule
                </Button>
              </CardContent>
            </Card>
          ) : (
            rules.map((r) => (
              <Card key={r.id} className="overflow-hidden">
                <div className="flex flex-row">
                  <div
                    className={cn(
                      "w-2 shrink-0",
                      r.trigger_type === "fallback"
                        ? "bg-amber-400"
                        : r.trigger_type === "greeting"
                          ? "bg-purple-500"
                          : "bg-blue-500",
                    )}
                  />
                  <div className="p-5 flex-1 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                    <div className="flex-1">
                      <div className="flex gap-2 items-center mb-2">
                        <Badge
                          variant="secondary"
                          className="capitalize bg-neutral-100 text-neutral-700"
                        >
                          {r.trigger_type.replace(/_/g, " ")}
                        </Badge>
                        {r.trigger_type === "keyword" && (
                          <div className="flex gap-1 flex-wrap">
                            {JSON.parse(r.keywords).map((k: string) => (
                              <Badge
                                key={k}
                                variant="outline"
                                className="text-xs bg-white text-blue-700 border-blue-200"
                              >
                                "{k}"
                              </Badge>
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-neutral-400">
                          Pri: {r.priority}
                        </span>
                      </div>
                      <p className="text-sm text-neutral-700 whitespace-pre-wrap bg-neutral-50 p-3 rounded-md border border-neutral-100 font-mono text-[13px]">
                        {r.reply_message}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      onClick={() => handleDeleteRule(r.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LogsPanel() {
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = query(collection(db, "logs"), orderBy("timestamp", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          console.log("Logs snapshot received:", snap.size, "documents");
          setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setError(null);
        },
        (err) => {
          console.error("Logs error:", err);
          setError(err.message);
        },
      );
      return () => unsub();
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-1">
              System Logs
            </h1>
            <p className="text-sm text-neutral-500">
              Real-time logs from your Cloudflare Worker to trace events.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const res = await fetch(`${WORKER_URL}/api/dashboard/send`, {
                    method: "POST",
                    body: JSON.stringify({ ping: true, testLog: true }),
                    headers: { "Content-Type": "application/json" },
                  });
                  const text = await res.text();
                  setError(`Ping result: ${res.status} ${text}`);
                } catch (e: any) {
                  setError(`Ping error: ${e.message}`);
                }
              }}
            >
              Ping Worker & Test Log
            </Button>
            <Button
              onClick={async () => {
                // Let's create a test log directly from client to verify permissions and collection
                try {
                  await addDoc(collection(db, "logs"), {
                    timestamp: new Date().toISOString(),
                    level: "info",
                    message: "Test log from UI (Verify Firebase is working)",
                    details: "{}",
                  });
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Create Test Log
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
            <strong>Error loading logs:</strong> {error}
          </div>
        )}

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-neutral-500 uppercase bg-neutral-50 border-b border-neutral-100">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Level</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-neutral-500"
                    >
                      Wait for events to be logged...
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-500 text-xs">
                        {new Date(l.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            l.level === "info"
                              ? "text-blue-600 border-blue-200"
                              : l.level === "warning"
                                ? "text-amber-600 border-amber-200"
                                : "text-red-600 border-red-200",
                          )}
                        >
                          {l.level}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-700">
                        {l.message}
                      </td>
                      <td className="px-4 py-3">
                        <pre className="text-[10px] text-neutral-500 whitespace-pre-wrap font-mono break-all max-w-xs md:max-w-md bg-neutral-100 p-2 rounded">
                          {l.details}
                        </pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    setWebhookUrl(
      WORKER_URL +
        (WORKER_URL.endsWith("/") ? "" : "/") +
        "api/seatalk/webhook",
    );
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-6">
          SeaTalk Setup Guide for Cloudflare
        </h1>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>1. Link Webhook to SeaTalk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-neutral-600">
            <p>
              To receive messages and send auto-replies, configure your
              Cloudflare Worker URL in your SeaTalk Developer Portal.
            </p>
            <div className="bg-neutral-900 text-green-400 font-mono text-sm p-4 rounded-lg break-all">
              {webhookUrl}
            </div>
            <ol className="list-decimal pl-5 space-y-2 mt-4 text-neutral-800">
              <li>
                Go to{" "}
                <a
                  href="https://open.seatalk.io/developer"
                  target="_blank"
                  className="text-blue-600 underline"
                >
                  SeaTalk Open Platform
                </a>
              </li>
              <li>Navigate to your App → Advanced Settings → Event Callback</li>
              <li>
                Click "Edit", paste your Cloudflare Worker URL, and click
                "Save".
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Export to Cloudflare</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600 space-y-4">
            <p>Follow these steps to fully move off AI Studio.</p>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <CheckCircle2
                  className="text-green-500 mt-0.5 shrink-0"
                  size={18}
                />
                <div>
                  <strong className="text-neutral-900 block mb-1">
                    Export Project
                  </strong>
                  <span className="text-neutral-500">
                    Go to Settings in the AI Studio IDE and Export the project
                    as a ZIP or to GitHub.
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2
                  className="text-green-500 mt-0.5 shrink-0"
                  size={18}
                />
                <div>
                  <strong className="text-neutral-900 block mb-1">
                    Follow README
                  </strong>
                  <span className="text-neutral-500">
                    Open <code>README-Cloudflare.md</code> in the project files
                    to see how to deploy the React dashboard to Cloudflare
                    Pages, and the Node Backend to Cloudflare Workers!
                  </span>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
