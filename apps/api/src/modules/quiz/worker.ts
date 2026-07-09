import { z } from 'zod';
import { generateQuiz } from './service';

/**
 * Worker job kvízov (M8): generovanie otázok LLM-om. Beží v sériovom
 * worker procese (jeden semafór — inferencie nikdy paralelne, §15).
 * Chybové stavy rieši generateQuiz sám (status failed + notifikácia),
 * job sa preto nevyhadzuje do retry fronty.
 */

const GenerateJobSchema = z.object({ quizId: z.string().uuid() });

export function registerQuizJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register('quiz.generate', async (payload) => {
    const job = GenerateJobSchema.parse(payload);
    await generateQuiz(job.quizId);
  });
}
