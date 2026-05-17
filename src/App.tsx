import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Bot, Send, User, Menu, Settings, X, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

// Firebase imports
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';

// Add motion for animations
import { motion, AnimatePresence } from 'motion/react';

// SET THIS to your Cloudflare Worker URL once deployed
const WORKER_URL = 'https://testbotworker.jcruspero3263.workers.dev'; // e.g., https://seatalk-bot-webhook.username.workers.dev

export default function App() {
  const [activeTab, setActiveTab] = useState('chat');
  
  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <ChatInterface />}
        {activeTab === 'rules' && <AutoReplyRules />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>
      <Toaster />
    </div>
  );
}

function Sidebar({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (v: string) => void }) {
  return (
    <div className="w-16 md:w-64 bg-white border-r border-neutral-200 flex flex-col items-center md:items-stretch py-4 transition-all overflow-hidden shrink-0">
      <div className="px-4 mb-8 hidden md:flex items-center gap-2">
        <div className="bg-blue-600 p-1.5 rounded-lg text-white">
          <Bot size={20} />
        </div>
        <h1 className="font-bold text-lg text-neutral-900 tracking-tight">SeaTalk Manager</h1>
      </div>
      <div className="px-0 md:px-3 flex-1 flex flex-col gap-2">
        <NavButton icon={<MessageSquare size={20} />} label="Conversations" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        <NavButton icon={<Bot size={20} />} label="Auto Replies" active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} />
        <NavButton icon={<Settings size={20} />} label="Setup Guide" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </div>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex justify-center md:justify-start items-center gap-3 p-3 md:px-4 rounded-xl transition-all w-full",
        active ? "bg-blue-50 text-blue-700 font-medium" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
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
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Listen to Firestore conversations
  useEffect(() => {
    try {
      const q = query(collection(db, 'conversations'), orderBy('last_message_time', 'desc'));
      const unsub = onSnapshot(q, (snap) => {
        const convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setConversations(convs);
        if (!activeConvId && convs.length > 0) {
          setActiveConvId(convs[0].id);
        }
      });
      return () => unsub();
    } catch (e) {
      console.log('Firebase not configured yet');
    }
  }, []);

  // Listen to Firestore messages
  useEffect(() => {
    if (!activeConvId) return;
    try {
      const q = query(collection(db, 'messages'), orderBy('sent_at', 'asc'));
      const unsub = onSnapshot(q, (snap) => {
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((m: any) => m.conversation_id === activeConvId);
        setMessages(msgs);
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);
        
        // Reset unread count
        updateDoc(doc(db, 'conversations', activeConvId), { unread_count: 0 }).catch(()=>{});
      });
      setLoading(false);
      return () => unsub();
    } catch (e) {}
  }, [activeConvId]);

  const activeConv = conversations.find(c => c.id === activeConvId);

  const sendMessage = async () => {
    if (!input.trim() || !activeConvId || !activeConv) return;
    const txt = input;
    setInput('');
    try {
      if (WORKER_URL.startsWith('http')) {
        await fetch(`${WORKER_URL.replace(/\/$/, '')}/api/dashboard/send`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ 
            conversation_id: activeConvId, 
            chat_type: activeConv.chat_type,
            target_id: activeConv.chat_type === 'private' ? activeConv.employee_code : activeConv.group_id,
            content: txt 
          })
        });
      } else {
        toast.info("Message saved locally. Deploy your worker to send it to SeaTalk!");
      }
    } catch(e) {
      toast.error('Failed to send message: ' + e);
    }
  }

  return (
    <div className="flex h-full bg-white relative">
      <div className={cn("w-full md:w-80 border-r border-neutral-200 flex flex-col absolute md:static inset-0 bg-white z-10 transition-transform", activeConvId ? "-translate-x-full md:translate-x-0" : "translate-x-0")}>
        <div className="p-4 border-b border-neutral-100 pb-4">
          <h2 className="font-semibold text-lg">Inbox</h2>
        </div>
        <ScrollArea className="flex-1">
          {conversations.map(c => (
            <button key={c.id} onClick={() => setActiveConvId(c.id)} className={cn("w-full text-left p-4 hover:bg-neutral-50 border-b border-neutral-100 transition-colors", activeConvId === c.id ? "bg-blue-50/50" : "")}>
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium text-neutral-900 truncate">
                  {c.chat_type === 'group' ? c.group_name || RegExp('group').test(c.chat_type) ? 'Group Chat' : c.group_id : c.user_name || c.employee_code}
                </span>
                {c.unread_count > 0 && <Badge variant="default" className="bg-blue-600 rounded-full w-5 h-5 flex items-center justify-center p-0 text-[10px]">{c.unread_count}</Badge>}
              </div>
              <div className="text-sm text-neutral-500 flex justify-between gap-2">
                <span className="truncate">{c.last_message || 'Started chat'}</span>
                <span className="text-xs whitespace-nowrap shrink-0">{new Date(c.last_message_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </div>
            </button>
          ))}
          {conversations.length === 0 && <div className="text-center p-8 text-neutral-400 text-sm">No conversations yet</div>}
        </ScrollArea>
      </div>

      <div className={cn("flex-1 flex flex-col absolute md:static inset-0 bg-white transition-transform", activeConvId ? "translate-x-0" : "translate-x-full md:translate-x-0")}>
        {activeConv ? (
          <>
            <div className="h-16 px-4 border-b border-neutral-200 flex flex-row items-center gap-3 shrink-0">
               <button className="md:hidden p-2 -ml-2 text-neutral-500" onClick={() => setActiveConvId(null)}><Menu /></button>
               <div className="flex-1">
                 <h2 className="font-semibold text-neutral-900">{activeConv.chat_type === 'group' ? activeConv.group_name || 'Group Chat' : activeConv.user_name || activeConv.employee_code}</h2>
                 <p className="text-xs text-neutral-500">{activeConv.chat_type === 'group' ? activeConv.group_id : activeConv.employee_code}</p>
               </div>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto bg-neutral-50/50" ref={scrollRef}>
              <div className="flex flex-col gap-4 max-w-3xl mx-auto">
                {messages.map((m, i) => {
                  const isMine = m.sender === 'admin' || m.sender === 'bot';
                  return (
                    <div key={m.id} className={cn("flex flex-col max-w-[75%]", isMine ? "self-end items-end" : "self-start")}>
                      <span className="text-xs text-neutral-400 mb-1 px-1">{m.sender_name} {m.is_auto_reply === 1 ? '(Auto-reply)' : ''}</span>
                      <div className={cn(
                        "p-3 rounded-2xl", 
                        isMine 
                          ? m.sender === 'bot' 
                              ? "bg-slate-700 text-white rounded-tr-sm" 
                              : "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-white border border-neutral-200 text-neutral-900 rounded-tl-sm shadow-sm"
                      )}>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                      </div>
                      <span className="text-[10px] text-neutral-400 mt-1 px-1">{new Date(m.sent_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="p-4 bg-white border-t border-neutral-200 shrink-0">
               <div className="max-w-3xl mx-auto flex gap-2">
                 <Textarea 
                   value={input} 
                   onChange={e => setInput(e.target.value)} 
                   placeholder="Type a manual reply..."
                   className="min-h-[44px] max-h-32 resize-none resize-y rounded-xl"
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.shiftKey) {
                       e.preventDefault();
                       sendMessage();
                     }
                   }}
                 />
                 <Button onClick={sendMessage} className="h-11 w-11 rounded-full shrink-0 self-end" size="icon">
                    <Send size={18} className="translate-x-[1px]" />
                 </Button>
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
  const [triggerType, setTriggerType] = useState('keyword');
  const [keywords, setKeywords] = useState('');
  const [matchType, setMatchType] = useState('contains');
  const [replyMessage, setReplyMessage] = useState('');
  const [priority, setPriority] = useState('0');

  useEffect(() => {
    try {
      const q = query(collection(db, 'rules'), orderBy('priority', 'desc'));
      const unsub = onSnapshot(q, (snap) => {
        setRules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      return () => unsub();
    } catch(e) {}
  }, []);

  const addRule = async () => {
    try {
      await addDoc(collection(db, 'rules'), {
        trigger_type: triggerType,
        keywords: triggerType === 'keyword' ? JSON.stringify(keywords.split(',').map(s=>s.trim()).filter(Boolean)) : '[]',
        match_type: matchType,
        reply_message: replyMessage,
        is_active: true,
        priority: parseInt(priority) || 0
      });
      setIsAddOpen(false);
      setKeywords('');
      setReplyMessage('');
      setPriority('0');
      toast.success("Rule added");
    } catch(e) {
      toast.error('Failed to add rule');
    }
  }

  const handleDeleteRule = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'rules', id));
      toast.success("Rule deleted");
    } catch(e) {
      toast.error('Failed to delete rule');
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-1">Auto-Replies</h1>
            <p className="text-sm text-neutral-500">Configure how the bot automatically responds to incoming messages.</p>
          </div>
          <Button className="gap-2" onClick={() => setIsAddOpen(true)}><Plus size={16} /> New Rule</Button>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Auto-Reply Rule</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Trigger Type</label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword Match</SelectItem>
                      <SelectItem value="greeting">Greeting (First Time)</SelectItem>
                      <SelectItem value="fallback">Fallback (No Match)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {triggerType === 'keyword' && (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Keywords</label>
                      <Input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="hello, help, support (comma separated)" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Match Type</label>
                      <Select value={matchType} onValueChange={setMatchType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contains">Contains (Recommended)</SelectItem>
                          <SelectItem value="exact">Exact Match</SelectItem>
                          <SelectItem value="starts_with">Starts With</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div className="space-y-1">
                   <label className="text-sm font-medium">Priority (Higher runs first)</label>
                   <Input type="number" value={priority} onChange={e=>setPriority(e.target.value)} />
                </div>

                <div className="space-y-1">
                   <label className="text-sm font-medium">Reply Message</label>
                   <Textarea value={replyMessage} onChange={e=>setReplyMessage(e.target.value)} rows={4} placeholder="Type the automated response..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button onClick={addRule} disabled={!replyMessage}>Save Rule</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-col gap-4">
          {rules.length === 0 ? (
            <Card className="border-dashed border-2 shadow-none bg-transparent">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Bot className="h-12 w-12 text-neutral-300 mb-4" />
                <h3 className="font-medium text-neutral-900 mb-1">No rules configured</h3>
                <p className="text-sm text-neutral-500 mb-4">Set up greeting, fallback, or keyword-based replies to start engaging users automatically.</p>
                <Button variant="outline" onClick={() => setIsAddOpen(true)}>Create your first rule</Button>
              </CardContent>
            </Card>
          ) : rules.map(r => (
            <Card key={r.id} className="overflow-hidden">
               <div className="flex flex-row">
                 <div className={cn("w-2 shrink-0", r.trigger_type === 'fallback' ? 'bg-amber-400' : r.trigger_type === 'greeting' ? 'bg-purple-500' : 'bg-blue-500')} />
                 <div className="p-5 flex-1 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                   <div className="flex-1">
                     <div className="flex gap-2 items-center mb-2">
                       <Badge variant="secondary" className="capitalize bg-neutral-100 text-neutral-700">{r.trigger_type}</Badge>
                       {r.trigger_type === 'keyword' && (
                         <div className="flex gap-1 flex-wrap">
                           {JSON.parse(r.keywords).map((k: string) => (
                             <Badge key={k} variant="outline" className="text-xs bg-white text-blue-700 border-blue-200">"{k}"</Badge>
                           ))}
                         </div>
                       )}
                       <span className="text-xs text-neutral-400">Pri: {r.priority}</span>
                     </div>
                     <p className="text-sm text-neutral-700 whitespace-pre-wrap bg-neutral-50 p-3 rounded-md border border-neutral-100 font-mono text-[13px]">{r.reply_message}</p>
                   </div>
                   <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0" onClick={() => handleDeleteRule(r.id)}>
                     <Trash2 size={16} />
                   </Button>
                 </div>
               </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function SettingsPanel() {
  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    setWebhookUrl(WORKER_URL + (WORKER_URL.endsWith('/') ? '' : '/') + 'api/seatalk/webhook');
  }, []);

  return (
     <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-3xl mx-auto">
         <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-6">SeaTalk Setup Guide for Cloudflare</h1>

         <Card className="mb-6">
           <CardHeader>
             <CardTitle>1. Link Webhook to SeaTalk</CardTitle>
           </CardHeader>
           <CardContent className="space-y-4 text-sm text-neutral-600">
             <p>To receive messages and send auto-replies, configure your Cloudflare Worker URL in your SeaTalk Developer Portal.</p>
             <div className="bg-neutral-900 text-green-400 font-mono text-sm p-4 rounded-lg break-all">
               {webhookUrl}
             </div>
             <ol className="list-decimal pl-5 space-y-2 mt-4 text-neutral-800">
               <li>Go to <a href="https://open.seatalk.io/developer" target="_blank" className="text-blue-600 underline">SeaTalk Open Platform</a></li>
               <li>Navigate to your App → Advanced Settings → Event Callback</li>
               <li>Click "Edit", paste your Cloudflare Worker URL, and click "Save".</li>
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
                 <CheckCircle2 className="text-green-500 mt-0.5 shrink-0" size={18} />
                 <div>
                   <strong className="text-neutral-900 block mb-1">Export Project</strong>
                   <span className="text-neutral-500">Go to Settings in the AI Studio IDE and Export the project as a ZIP or to GitHub.</span>
                 </div>
               </li>
               <li className="flex items-start gap-3">
                 <CheckCircle2 className="text-green-500 mt-0.5 shrink-0" size={18} />
                 <div>
                   <strong className="text-neutral-900 block mb-1">Follow README</strong>
                   <span className="text-neutral-500">Open <code>README-Cloudflare.md</code> in the project files to see how to deploy the React dashboard to Cloudflare Pages, and the Node Backend to Cloudflare Workers!</span>
                 </div>
               </li>
             </ul>
           </CardContent>
         </Card>
      </div>
    </div>
  )
}
