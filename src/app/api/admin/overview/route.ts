import { requireAdmin } from '@/server/auth';
import { getActivePrompt } from '@/server/db';
import { failure, json } from '@/server/http';
import { benchmarkStats, liveStats, MIN_BENCHMARK_SAMPLES, readinessChecks, reviewDashboardStats } from '@/server/stats';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const version = getActivePrompt().version;
    return json({active_version:version,live:liveStats(7),benchmark:benchmarkStats(version),
      min_benchmark_samples:MIN_BENCHMARK_SAMPLES,checks:readinessChecks(),review_dashboard:reviewDashboardStats(50)});
  } catch (error) { return failure(error); }
}
