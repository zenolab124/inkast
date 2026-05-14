import { useEffect, useState } from "react";
import { Clock, ImagePlus, Loader2, Sparkles } from "lucide-react";
import type { JobRecord } from "@inkast/shared";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/i18n/LanguageContext";

interface ActiveJobsProps {
  jobs: JobRecord[];
}

/**
 * "In-flight" job cards shown between the prose input and the field editor.
 * Refresh-safe: the parent's useJobs() hook seeds this from the API on mount.
 */
export function ActiveJobs({ jobs }: ActiveJobsProps) {
  if (jobs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      {jobs.map(job => (
        <ActiveJobCard key={job.id} job={job} />
      ))}
    </section>
  );
}

function ActiveJobCard({ job }: { job: JobRecord }) {
  const { t } = useLanguage();
  const elapsed = useElapsedSeconds(job.startedAt ?? job.createdAt);
  const isRunning = job.status === "running";
  const Icon = isRunning ? Loader2 : Clock;
  const ModeIcon = job.isRaw ? ImagePlus : Sparkles;
  return (
    <Card className="flex items-center gap-3 rounded-md border-border/60 bg-card px-4 py-3 shadow-(--shadow-paper)">
      <Icon
        className={
          isRunning
            ? "size-4 shrink-0 animate-spin text-primary"
            : "size-4 shrink-0 text-muted-foreground"
        }
        strokeWidth={1.75}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <ModeIcon className="size-3" strokeWidth={1.75} />
          <span>{isRunning ? t.jobs.statusRunning : t.jobs.statusPending}</span>
          <span>·</span>
          <span>{elapsed}s</span>
          <span>·</span>
          <span>{job.size}</span>
        </div>
        <div className="truncate text-sm text-foreground/90">
          {job.promptText.length > 120
            ? `${job.promptText.slice(0, 120)}…`
            : job.promptText}
        </div>
      </div>
    </Card>
  );
}

function useElapsedSeconds(startMs: number): number {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startMs) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [startMs]);
  return seconds;
}
