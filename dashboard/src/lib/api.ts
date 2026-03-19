export {
  useLogin,
  useSignup,
  useGetMe,
  useGetBusiness,
  useUpdateBusiness,
  useCreateBusiness,
  useDeleteBusinessData,
  useListCalls,
  useGetCall,
  useGetCallRetrieval,
  useListVoicemails,
  useUpdateVoicemail,
  useListDocuments,
  useUploadDocument,
  useListReservations,
  useGetCalendarAuth,
  useListCampaigns,
  useGetCampaign,
  useCreateCampaign,
  useListCampaignContacts,
  useRetryCampaignDlq,
  useMakeOutboundCall,
  useListDnc,
  useAddDnc,
  useRemoveDnc,
  useSendSms,
  useListFlags,
  useUpdateFlag,
  useStreamEvents,
  useGetAnalyticsSummary,
  getGetMeQueryKey,
  getListVoicemailsQueryKey,
  getListDocumentsQueryKey,
  getGetCampaignQueryKey,
  getListCampaignContactsQueryKey,
} from "@/api-client";

export type {
  Business,
  CallLog,
  Voicemail,
  Campaign,
  CampaignContact,
  CalendarReservation,
  MeResponse,
  LoginResponse,
  AnalyticsSummary,
} from "@/api-client";

export function isApiError(error: unknown): error is { status: number; message: string; headers: Headers } {
  return (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    "message" in error
  );
}

export function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export function isRateLimited(error: unknown): boolean {
  return isApiError(error) && error.status === 429;
}

export function getRetryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error) || error.status !== 429) return null;
  const retryAfter = error.headers?.get?.("retry-after");
  if (!retryAfter) return null;
  const seconds = parseInt(retryAfter, 10);
  return isNaN(seconds) ? null : seconds;
}

export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 401) return "Your session has expired. Please sign in again.";
    if (error.status === 429) {
      const seconds = getRetryAfterSeconds(error);
      return seconds
        ? `Too many requests. Please try again in ${seconds} seconds.`
        : "Too many requests. Please try again later.";
    }
    if (error.status === 403) return "You don't have permission to perform this action.";
    if (error.status === 404) return "The requested resource was not found.";
    if (error.status >= 500) return "A server error occurred. Please try again later.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
