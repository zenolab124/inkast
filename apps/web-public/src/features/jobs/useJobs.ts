import { useCallback, useEffect, useRef, useState } from "react";
import type { JobRecord, SubmitJobRequest } from "@inkast/shared";
import { getJob, listJobs, submitGenerateJob } from "./api.js";

const POLL_INTERVAL_MS = 2000;

interface UseJobsOptions {
  onSucceeded?: (job: JobRecord) => void;
  onFailed?: (job: JobRecord) => void;
}

interface UseJobsReturn {
  activeJobs: JobRecord[];
  submitJob: (req: SubmitJobRequest) => Promise<string>;
}

/**
 * Manage the lifecycle of async image-generation jobs.
 *
 * - On mount, recovers in-flight jobs from the API (lets us show progress
 *   cards across page refreshes).
 * - Polls the API every 2s while any job is active; stops polling when the
 *   active list empties.
 * - Diffs the previous vs next active list — jobs that disappeared get their
 *   final state fetched via getJob, and the onSucceeded/onFailed callbacks
 *   fire so the parent can refresh Gallery / show a banner.
 */
export function useJobs({ onSucceeded, onFailed }: UseJobsOptions = {}): UseJobsReturn {
  const [activeJobs, setActiveJobs] = useState<JobRecord[]>([]);

  // Keep refs fresh so the interval doesn't restart on every poll tick or
  // callback change.
  const activeJobsRef = useRef(activeJobs);
  activeJobsRef.current = activeJobs;
  const onSucceededRef = useRef(onSucceeded);
  onSucceededRef.current = onSucceeded;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  // Startup: pull any in-flight jobs the API still knows about.
  useEffect(() => {
    let cancelled = false;
    listJobs({ status: ["pending", "running"], limit: 50 })
      .then(jobs => {
        if (!cancelled) setActiveJobs(jobs);
      })
      .catch(err => console.error("[jobs] startup recover failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasActive = activeJobs.length > 0;

  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const nextActive = await listJobs({
          status: ["pending", "running"],
          limit: 50,
        });
        if (cancelled) return;
        const prevIds = activeJobsRef.current.map(j => j.id);
        const nextIds = new Set(nextActive.map(j => j.id));
        const removed = prevIds.filter(id => !nextIds.has(id));
        for (const id of removed) {
          try {
            const job = await getJob(id);
            if (cancelled) return;
            if (job.status === "succeeded") onSucceededRef.current?.(job);
            else if (job.status === "failed") onFailedRef.current?.(job);
          } catch (err) {
            console.error(`[jobs] fetch removed job ${id} failed:`, err);
          }
        }
        setActiveJobs(nextActive);
      } catch (err) {
        console.error("[jobs] poll tick failed:", err);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasActive]);

  const submitJob = useCallback(async (req: SubmitJobRequest): Promise<string> => {
    const { jobId } = await submitGenerateJob(req);
    // Optimistically insert a placeholder job so the card appears
    // immediately. The next poll tick replaces it with the authoritative row.
    setActiveJobs(prev => [
      ...prev,
      {
        id: jobId,
        kind: "image_generate",
        status: "pending",
        promptSnapshot: req.prompt,
        promptText: req.rawPrompt ?? JSON.stringify(req.prompt),
        isRaw: !!req.rawPrompt,
        size: req.size ?? "1024x1024",
        quality: req.quality ?? "high",
        generationId: null,
        attempts: [],
        errorCode: null,
        errorMessage: null,
        providerId: null,
        providerName: null,
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
      },
    ]);
    return jobId;
  }, []);

  return { activeJobs, submitJob };
}
