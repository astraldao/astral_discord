// Only messages created by calendar code are suitable for a user-facing reply.
// Native/API errors can contain request details or filesystem paths.
export class ScheduleError extends Error {}

export function scheduleErrorMessage(error){
  return error instanceof ScheduleError?error.message:'操作を完了できませんでした。権限や接続を確認して、予定表を開き直してください。';
}
