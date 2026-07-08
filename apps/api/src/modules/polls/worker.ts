import { z } from 'zod';
import { closeByDeadline } from './service';

/** Payload jobu 'polls.close' (enqueuje createPoll pri zadanom deadline). */
const PollsCloseJobSchema = z.object({ pollId: z.string().uuid() });

/** Registrácia job handlerov modulu do worker procesu (volá worker/index.ts). */
export function registerPollsJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register('polls.close', async (payload) => {
    const job = PollsCloseJobSchema.parse(payload);
    await closeByDeadline(job.pollId);
  });
}
