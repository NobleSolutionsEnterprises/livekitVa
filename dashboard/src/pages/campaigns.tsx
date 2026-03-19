import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListCampaigns, Campaign } from "@/api-client";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Megaphone, Plus } from "lucide-react";

export default function Campaigns() {
  const { businessId } = useAuth();
  const { data, isLoading } = useListCampaigns(businessId!);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Outbound Campaigns</h1>
          <p className="text-muted-foreground mt-1">Automate calls to lists of contacts.</p>
        </div>
        
        <Link href="/campaigns/new">
          <Button className="shadow-lg shadow-primary/25">
            <Plus className="w-4 h-4 mr-2" /> New Campaign
          </Button>
        </Link>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead>Campaign Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[30%]">Progress</TableHead>
              <TableHead>DLQ / Failed</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                  <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  No campaigns running.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((camp: Campaign) => (
                <TableRow key={camp.id} className="border-border/50 group cursor-pointer hover:bg-muted/30 transition-colors">
                  <TableCell className="font-bold">
                    <Link href={`/campaigns/${camp.id}`} className="hover:text-primary transition-colors block">
                      {camp.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {camp.status === 'running' && <Badge className="bg-blue-500/10 text-blue-500 animate-pulse">Running</Badge>}
                    {camp.status === 'completed' && <Badge className="bg-emerald-500/10 text-emerald-500">Completed</Badge>}
                    {camp.status === 'pending' && <Badge variant="secondary">Pending</Badge>}
                    {camp.status === 'cancelled' && <Badge variant="outline">Cancelled</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Progress value={(camp.calls_completed / Math.max(camp.calls_total, 1)) * 100} className="h-2 flex-1" />
                      <span className="text-xs font-mono text-muted-foreground w-12">{camp.calls_completed}/{camp.calls_total}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {camp.calls_failed > 0 ? (
                      <Badge variant="destructive" className="font-mono">{camp.calls_failed}</Badge>
                    ) : (
                      <span className="text-muted-foreground font-mono">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(camp.created_at), 'MMM d, yyyy')}
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
