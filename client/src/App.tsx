import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp, StorageBanner } from "@/lib/app-context";
import { FeedbackProvider } from "@/components/feedback";
import { AppShell } from "@/components/layout";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth";
import TodayPage from "@/pages/today";
import TasksPage from "@/pages/tasks";
import AchievementsPage from "@/pages/achievements";
import SkillTreePage from "@/pages/skill-tree";
import RewardsPage from "@/pages/rewards";
import StatsPage from "@/pages/stats";
import SettingsPage from "@/pages/settings";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={TodayPage} />
      <Route path="/tasks" component={TasksPage} />
      <Route path="/achievements" component={AchievementsPage} />
      <Route path="/skill-tree" component={SkillTreePage} />
      <Route path="/rewards" component={RewardsPage} />
      <Route path="/stats" component={StatsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Gate() {
  const { user, booting } = useApp();
  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">正在载入本地数据…</p>
      </div>
    );
  }
  if (!user)
    return (
      <>
        <AuthPage />
      </>
    );
  return (
    <FeedbackProvider>
      <AppShell>
        <StorageBanner />
        <AppRouter />
      </AppShell>
    </FeedbackProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <Gate />
          </Router>
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
