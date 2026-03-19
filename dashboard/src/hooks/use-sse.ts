import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { 
  getListCallsQueryKey, 
  getListVoicemailsQueryKey, 
  getListDocumentsQueryKey, 
  getListCampaignsQueryKey 
} from '@/api-client';

export function useSSE(businessId?: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!businessId) return;

    let ws: EventSource;
    let reconnectTimer: NodeJS.Timeout;
    let delay = 1000;

    function connect() {
      // EventSource natively includes credentials for same-origin or when specified
      ws = new EventSource(`/api/businesses/${businessId}/events/stream`, { withCredentials: true });

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          
          if (event.type === 'call.started' || event.type === 'call.ended') {
            queryClient.invalidateQueries({ queryKey: getListCallsQueryKey(businessId!) });
          } else if (event.type === 'voicemail.new') {
            queryClient.invalidateQueries({ queryKey: getListVoicemailsQueryKey(businessId!) });
            toast({ 
              title: "New Voicemail", 
              description: "You have received a new voicemail.",
              className: "bg-primary text-primary-foreground border-primary" 
            });
          } else if (event.type === 'document.ready' || event.type === 'document.error') {
            queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(businessId!) });
          } else if (event.type === 'campaign.progress') {
            queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(businessId!) });
          }
        } catch (err) {
          console.error("SSE parse error", err);
        }
      };

      ws.onerror = () => {
        ws.close();
        delay = Math.min(delay * 2, 30000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onopen = () => {
        delay = 1000; // reset on success
      };
    }

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, [businessId, queryClient, toast]);
}
