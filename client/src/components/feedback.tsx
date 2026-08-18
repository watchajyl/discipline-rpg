import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { achievementById, RARITY_META } from "@shared/achievements";
import type { SettleResult } from "@/lib/types";
import { Num } from "./bits";
import * as Icons from "lucide-react";
import { Button } from "@/components/ui/button";

type Floater = { id: number; text: string; tone: "xp" | "points" | "prof" };

type Ctx = {
  report: (result: SettleResult, taskTitle?: string) => void;
  floaters: Floater[];
};

const FeedbackContext = createContext<Ctx | null>(null);

let floaterId = 0;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [celebration, setCelebration] = useState<
    { kind: "achievement"; id: string } | { kind: "level"; level: number; title: string } | null
  >(null);
  const [queue, setQueue] = useState<({ kind: "achievement"; id: string } | { kind: "level"; level: number; title: string })[]>([]);

  const pushFloater = useCallback((text: string, tone: Floater["tone"]) => {
    const id = ++floaterId;
    setFloaters((f) => [...f, { id, text, tone }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1500);
  }, []);

  const report = useCallback(
    (result: SettleResult, taskTitle?: string) => {
      const g = result.gained;
      const total = {
        xp: g.xp + (result.finishBonus?.xp ?? 0),
        points: g.points + (result.finishBonus?.points ?? 0),
        prof: g.prof + (result.finishBonus?.prof ?? 0),
      };
      if (total.xp !== 0) pushFloater(`${total.xp > 0 ? "+" : ""}${total.xp} XP`, "xp");
      if (total.points !== 0) setTimeout(() => pushFloater(`${total.points > 0 ? "+" : ""}${total.points} 积分`, "points"), 160);
      if (total.prof !== 0) setTimeout(() => pushFloater(`${total.prof > 0 ? "+" : ""}${total.prof} 熟练度`, "prof"), 320);

      const parts: string[] = [];
      if (total.xp !== 0) parts.push(`经验 ${total.xp > 0 ? "+" : ""}${total.xp}`);
      if (total.points !== 0) parts.push(`积分 ${total.points > 0 ? "+" : ""}${total.points}`);
      if (total.prof !== 0) parts.push(`熟练度 ${total.prof > 0 ? "+" : ""}${total.prof}`);
      if (result.streakMul && result.streakMul > 1) parts.push(`连续加成 ×${result.streakMul}`);
      if (result.finishBonus) parts.push("含收官奖励");
      toast({
        title: result.message ?? (taskTitle ? `${taskTitle} 已结算` : "结算成功"),
        description: parts.length ? parts.join(" · ") : "本次没有奖励变化",
      });

      const events: typeof queue = [];
      if (result.levelUp) events.push({ kind: "level", level: result.levelUp.to, title: result.levelUp.title });
      for (const id of result.newAchievements ?? []) events.push({ kind: "achievement", id });
      if (events.length) {
        setCelebration((cur) => cur ?? events[0]);
        setQueue((q) => [...q, ...events.slice(1)]);
      }
    },
    [pushFloater, toast],
  );

  function closeCelebration() {
    if (queue.length) {
      setCelebration(queue[0]);
      setQueue((q) => q.slice(1));
    } else {
      setCelebration(null);
    }
  }

  const ach = celebration?.kind === "achievement" ? achievementById(celebration.id) : undefined;
  const AchIcon = ach ? ((Icons as any)[ach.icon] ?? Icons.Award) : Icons.Award;
  const rarity = ach ? RARITY_META[ach.rarity] : null;

  return (
    <FeedbackContext.Provider value={{ report, floaters }}>
      {children}

      {/* 经验飘字 */}
      <div className="pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 flex flex-col items-center gap-1">
        <AnimatePresence>
          {floaters.map((f) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: -28, scale: 1 }}
              exit={{ opacity: 0, y: -46 }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              className="num rounded-full border border-border bg-card px-3 py-1 text-sm font-bold shadow-lg"
              style={{
                color:
                  f.tone === "xp"
                    ? "hsl(var(--primary))"
                    : f.tone === "points"
                      ? "hsl(var(--cat-finance))"
                      : "hsl(var(--success))",
              }}
            >
              {f.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 成就 / 升级庆祝 */}
      <AnimatePresence>
        {celebration && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCelebration}
            data-testid="overlay-celebration"
          >
            {/* 粒子 */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {Array.from({ length: 18 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="absolute h-1.5 w-1.5 rounded-full"
                  style={{
                    left: `${50 + (Math.random() * 40 - 20)}%`,
                    top: "52%",
                    background: i % 3 === 0 ? "hsl(var(--primary))" : i % 3 === 1 ? "hsl(var(--cat-finance))" : "hsl(var(--success))",
                  }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{
                    opacity: [0, 1, 0],
                    scale: [0, 1, 0.6],
                    x: (Math.random() - 0.5) * 320,
                    y: (Math.random() - 0.7) * 300,
                  }}
                  transition={{ duration: 1.4 + Math.random(), ease: "easeOut", delay: i * 0.03 }}
                />
              ))}
            </div>
            <motion.div
              className="ach-pop relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
              initial={{ rotateY: -80, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                style={{
                  background:
                    celebration.kind === "achievement" && rarity
                      ? `hsl(${rarity.hsl} / 0.16)`
                      : "hsl(var(--primary) / 0.16)",
                  color:
                    celebration.kind === "achievement" && rarity ? `hsl(${rarity.hsl})` : "hsl(var(--primary))",
                  boxShadow:
                    celebration.kind === "achievement" && rarity
                      ? `0 0 34px hsl(${rarity.hsl} / 0.4)`
                      : "0 0 34px hsl(var(--primary) / 0.4)",
                }}
              >
                {celebration.kind === "achievement" ? (
                  <AchIcon className="h-8 w-8" />
                ) : (
                  <Icons.Sparkles className="h-8 w-8" />
                )}
              </div>
              {celebration.kind === "achievement" && ach ? (
                <>
                  <p className="text-xs tracking-widest text-muted-foreground">成就解锁</p>
                  <p className="mt-1 text-xl font-bold leading-snug">{ach.name}</p>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{ach.desc}</p>
                  <p className="mt-3 text-sm">
                    <span style={{ color: `hsl(${rarity!.hsl})` }}>{rarity!.name}</span>
                    <span className="text-muted-foreground"> · 奖励 </span>
                    <Num className="font-bold text-cat-finance">{rarity!.reward}</Num>
                    <span className="text-muted-foreground"> 积分</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs tracking-widest text-muted-foreground">等级提升</p>
                  <p className="mt-1 text-xl font-bold">
                    Lv.<Num>{(celebration as any).level}</Num> · {(celebration as any).title}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    积累在稳步变成实力，继续保持这个节奏。
                  </p>
                </>
              )}
              <Button className="mt-5 w-full" onClick={closeCelebration} data-testid="button-close-celebration">
                收下
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback 必须在 FeedbackProvider 内使用");
  return ctx;
}
