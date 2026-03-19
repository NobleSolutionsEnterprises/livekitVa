import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListCalls, CallLog, ListCallsDirection } from "@/api-client";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneIncoming, PhoneOutgoing, Loader2, Phone } from "lucide-react";

export const OUTCOME_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  transferred: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  voicemail: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  rate_limited: "bg-red-500/10 text-red-500 border-red-500/20",
  after_hours: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  overflow: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  booked: "bg-teal-500/10 text-teal-500 border-teal-500/20",
};

export default function Calls() {
  const { businessId } = useAuth();
  const [outcome, setOutcome] = useState<string>("all");
  const [direction, setDirection] = useState<string>("all");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<CallLog[]>([]);
  const prevCursorRef = useRef<string | undefined>(undefined);
  
  const queryParams = {
    limit: 50,
    ...(outcome !== 'all' ? { outcome } : {}),
    ...(direction !== 'all' ? { direction: direction as ListCallsDirection } : {}),
    ...(cursor ? { cursor } : {}),
  };

  const { data, isLoading, isFetching } = useListCalls(businessId!, queryParams);

  useEffect(() => {
    if (!data?.items) return;
    if (cursor && cursor !== prevCursorRef.current) {
      setAccumulated(prev => [...prev, ...data.items]);
      prevCursorRef.current = cursor;
    } else if (!cursor) {
      setAccumulated([]);
      prevCursorRef.current = undefined;
    }
  }, [data, cursor]);

  const displayItems = accumulated.length > 0 ? accumulated : (data?.items || []);

  const handleLoadMore = useCallback(() => {
    if (data?.next_cursor) {
      if (accumulated.length === 0 && data.items) {
        setAccumulated(data.items);
      }
      setCursor(data.next_cursor);
    }
  }, [data?.next_cursor, data?.items, accumulated.length]);

  const handleFilterChange = useCallback((type: 'direction' | 'outcome', value: string) => {
    setCursor(undefined);
    setAccumulated([]);
    prevCursorRef.current = undefined;
    if (type === 'direction') setDirection(value);
    else setOutcome(value);
  }, []);

  const isLoadingMore = isFetching && accumulated.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Call Logs</h1>
          <p className="text-muted-foreground mt-1">Real-time history of all interactions.</p>
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
          <Select value={direction} onValueChange={v => handleFilterChange('direction', v)}>
            <SelectTrigger className="w-[140px] bg-card">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Directions</SelectItem>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>

          <Select value={outcome} onValueChange={v => handleFilterChange('outcome', v)}>
            <SelectTrigger className="w-[160px] bg-card">
              <SelectValue placeholder="Outcome" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Outcomes</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="transferred">Transferred</SelectItem>
              <SelectItem value="voicemail">Voicemail</SelectItem>
              <SelectItem value="booked">Booked</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead>Direction</TableHead>
                <TableHead>Caller</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell><div className="h-5 w-5 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-40 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-12 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-6 w-24 bg-muted rounded-full animate-pulse" /></TableCell>
                  </TableRow>
                ))
              ) : displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                    <Phone className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    No calls found matching your filters.
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((call: CallLog) => (
                  <TableRow key={call.id} className="border-border/50 hover:bg-muted/30 transition-colors group cursor-pointer">
                    <TableCell>
                      {call.direction === 'inbound' 
                        ? <PhoneIncoming className="w-5 h-5 text-blue-500" /> 
                        : <PhoneOutgoing className="w-5 h-5 text-emerald-500" />}
                    </TableCell>
                    <TableCell className="font-mono font-medium">
                      <Link href={`/calls/${call.id}`} className="hover:underline hover:text-primary transition-colors">
                        {call.caller_number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(call.started_at), 'MMM d, yyyy • h:mm a')}
                    </TableCell>
                    <TableCell className="font-mono">
                      {call.duration_sec ? `${Math.floor(call.duration_sec / 60)}:${(call.duration_sec % 60).toString().padStart(2, '0')}` : '--:--'}
                    </TableCell>
                    <TableCell>
                      {call.outcome && (
                        <Badge variant="outline" className={`capitalize border ${OUTCOME_COLORS[call.outcome] || 'bg-card text-foreground'}`}>
                          {call.outcome.replace('_', ' ')}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {data?.next_cursor && (
          <div className="p-4 border-t border-border/50 flex justify-center bg-muted/20">
            <Button 
              variant="outline" 
              className="rounded-full px-8" 
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading...</> : "Load More"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
