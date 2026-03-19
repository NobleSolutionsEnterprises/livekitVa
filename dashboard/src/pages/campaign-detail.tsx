import { useRoute, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetCampaign, useListCampaignContacts, useRetryCampaignDlq } from "@/api-client";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, AlertCircle } from "lucide-react";
import { getGetCampaignQueryKey, getListCampaignContactsQueryKey } from "@/api-client";

export default function CampaignDetail() {
  const [, params] = useRoute("/campaigns/:id");
  const campaignId = params?.id;
  const { businessId } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: camp, isLoading } = useGetCampaign(businessId!, campaignId || "");
  const { data: contacts } = useListCampaignContacts(businessId!, campaignId || "", { limit: 100 });
  const retryDlq = useRetryCampaignDlq();

  const handleRetry = async () => {
    try {
      const res = await retryDlq.mutateAsync({ businessId: businessId!, campaignId: campaignId! });
      toast({ title: "Retrying", description: `Queued ${res.retried} failed calls for retry.` });
      queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(businessId!, campaignId!) });
      queryClient.invalidateQueries({ queryKey: getListCampaignContactsQueryKey(businessId!, campaignId!) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Retry Failed", description: message, variant: "destructive" });
    }
  };

  if (isLoading) return <div className="p-12 flex justify-center"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!camp) return <div className="text-center p-12">Campaign not found</div>;

  const dlqCount = camp.calls_failed;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Link href="/campaigns" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Campaigns
      </Link>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 p-6 md:p-8 bg-card/50 backdrop-blur-xl border-border/50 shadow-xl shadow-black/5">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground mb-2">{camp.name}</h1>
              <p className="text-sm text-muted-foreground">Started {format(new Date(camp.created_at), 'PPP')}</p>
            </div>
            <Badge className="uppercase tracking-wider font-bold">{camp.status}</Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span>Progress</span>
              <span>{camp.calls_completed} / {camp.calls_total} Calls</span>
            </div>
            <Progress value={(camp.calls_completed / Math.max(camp.calls_total, 1)) * 100} className="h-3" />
          </div>
        </Card>

        <Card className="p-6 bg-destructive/5 border-destructive/20 flex flex-col justify-center items-center text-center">
          <AlertCircle className="w-8 h-8 text-destructive mb-3" />
          <h3 className="text-3xl font-mono font-bold text-destructive">{dlqCount}</h3>
          <p className="text-sm text-destructive/80 mb-4 font-medium uppercase tracking-widest">Failed / DLQ</p>
          <Button 
            variant="destructive" 
            onClick={handleRetry} 
            disabled={dlqCount === 0 || retryDlq.isPending}
            className="w-full shadow-lg shadow-destructive/20"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${retryDlq.isPending ? 'animate-spin' : ''}`} /> Retry Failed
          </Button>
        </Card>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
        <div className="p-6 border-b border-border/50">
          <h3 className="text-lg font-bold font-display">Contact List</h3>
        </div>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50">
              <TableHead>Phone Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!contacts?.items.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No contacts found.</TableCell></TableRow>
            ) : (
              contacts.items.map((contact) => (
                <TableRow key={contact.id} className="border-border/50">
                  <TableCell className="font-mono font-medium">{contact.phone_number}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={contact.status === 'dlq' || contact.status === 'failed' ? 'border-destructive text-destructive' : 'capitalize'}>
                      {contact.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{contact.outcome || '-'}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{contact.attempts}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {contact.dlq_reason 
                      ? contact.dlq_reason 
                      : contact.called_at 
                        ? format(new Date(contact.called_at), 'MMM d, h:mm a') 
                        : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
