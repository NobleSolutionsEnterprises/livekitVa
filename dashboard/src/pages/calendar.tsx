import { useAuth } from "@/lib/auth";
import { useGetCalendarAuth, useListReservations, useListSyncFailures, CalendarReservation } from "@/api-client";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Link2, AlertTriangle } from "lucide-react";

export default function Calendar() {
  const { businessId } = useAuth();
  const { data: authData } = useGetCalendarAuth(businessId!);
  const { data: reservations, isLoading } = useListReservations(businessId!);
  const { data: failures } = useListSyncFailures(businessId!);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Calendar</h1>
          <p className="text-muted-foreground mt-1">Manage AI-booked appointments and sync.</p>
        </div>
        
        {authData && (
          <Button 
            onClick={() => window.location.href = authData.auth_url}
            className="bg-white text-black hover:bg-gray-100 shadow-lg"
          >
            <Link2 className="w-4 h-4 mr-2" /> Connect Google Calendar
          </Button>
        )}
      </div>

      {failures && failures.items.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
          <div className="p-4 flex items-start gap-3 border-b border-destructive/20">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-destructive">Sync Failures</h4>
              <p className="text-sm text-destructive/80 mt-1">{failures.items.length} reservation{failures.items.length !== 1 ? 's' : ''} failed to sync with your external calendar.</p>
            </div>
          </div>
          <Table>
            <TableHeader className="bg-destructive/5">
              <TableRow className="border-destructive/20 hover:bg-transparent">
                <TableHead>Caller</TableHead>
                <TableHead>Scheduled Time</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.items.map((fail: CalendarReservation) => (
                <TableRow key={fail.id} className="border-destructive/20">
                  <TableCell className="font-mono font-medium">{fail.caller_number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {fail.start_ts ? format(new Date(fail.start_ts), 'MMM d, h:mm a') : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive">Sync Failed</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="border-border/50 bg-card/50 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead>Caller</TableHead>
              <TableHead>Start Time</TableHead>
              <TableHead>End Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sync Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow>
            ) : !reservations?.items.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                  <CalendarIcon className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  No reservations found.
                </TableCell>
              </TableRow>
            ) : (
              reservations.items.map((res: CalendarReservation) => (
                <TableRow key={res.id} className="border-border/50">
                  <TableCell className="font-mono font-medium">{res.caller_number}</TableCell>
                  <TableCell>{format(new Date(res.start_ts), 'MMM d, h:mm a')}</TableCell>
                  <TableCell>{format(new Date(res.end_ts), 'h:mm a')}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{res.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {res.sync_status === 'synced' && <Badge className="bg-emerald-500/10 text-emerald-500">Synced</Badge>}
                    {res.sync_status === 'pending_sync' && <Badge variant="secondary">Pending</Badge>}
                    {res.sync_status === 'sync_failed' && <Badge variant="destructive">Failed</Badge>}
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
