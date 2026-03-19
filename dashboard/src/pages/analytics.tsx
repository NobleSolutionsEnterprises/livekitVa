import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useListCalls } from "@/api-client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { format, parseISO } from "date-fns";
import { PhoneCall, Clock, RefreshCcw, CheckSquare } from "lucide-react";

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#f59e0b', '#64748b'];

export default function Analytics() {
  const { businessId } = useAuth();
  const { data, isLoading } = useListCalls(businessId!, { limit: 1000 });

  const calls = data?.items || [];

  const { totalCalls, avgDuration, transferRate, answerRate, volumeData, outcomeData, topCallers } = useMemo(() => {
    const totalCalls = calls.length;
    const avgDuration = totalCalls ? calls.reduce((acc, c) => acc + (c.duration_sec || 0), 0) / totalCalls : 0;
    
    const transfers = calls.filter(c => c.outcome === 'transferred').length;
    const transferRate = totalCalls ? (transfers / totalCalls) * 100 : 0;
    
    const answered = calls.filter(c => (c.duration_sec || 0) > 5).length;
    const answerRate = totalCalls ? (answered / totalCalls) * 100 : 0;

    const volumeMap: Record<string, number> = {};
    calls.forEach(c => {
      const day = format(parseISO(c.started_at), 'MMM dd');
      volumeMap[day] = (volumeMap[day] || 0) + 1;
    });
    const volumeData = Object.entries(volumeMap).map(([name, value]) => ({ name, value })).slice(-14);

    const outcomeMap: Record<string, number> = {};
    calls.forEach(c => {
      if (c.outcome) {
        outcomeMap[c.outcome] = (outcomeMap[c.outcome] || 0) + 1;
      }
    });
    const outcomeData = Object.entries(outcomeMap).map(([name, value]) => ({ name: name.replace('_', ' '), value }));

    const callerMap: Record<string, { count: number; totalDuration: number }> = {};
    calls.forEach(c => {
      if (!callerMap[c.caller_number]) {
        callerMap[c.caller_number] = { count: 0, totalDuration: 0 };
      }
      callerMap[c.caller_number].count += 1;
      callerMap[c.caller_number].totalDuration += (c.duration_sec || 0);
    });
    const topCallers = Object.entries(callerMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([number, stats]) => ({ number, ...stats }));

    return { totalCalls, avgDuration, transferRate, answerRate, volumeData, outcomeData, topCallers };
  }, [calls]);

  if (isLoading) return <div className="p-12 flex justify-center"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground mt-1">High-level metrics derived from your call logs.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Total Calls</p>
              <h3 className="text-4xl font-display font-bold mt-2">{totalCalls}</h3>
            </div>
            <div className="p-3 bg-primary/10 rounded-xl text-primary"><PhoneCall className="w-5 h-5"/></div>
          </div>
        </Card>
        
        <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Avg Duration</p>
              <h3 className="text-4xl font-display font-bold mt-2">{Math.round(avgDuration)}s</h3>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-500"><Clock className="w-5 h-5"/></div>
          </div>
        </Card>

        <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Transfer Rate</p>
              <h3 className="text-4xl font-display font-bold mt-2">{transferRate.toFixed(1)}%</h3>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-xl text-blue-500"><RefreshCcw className="w-5 h-5"/></div>
          </div>
        </Card>

        <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Answer Rate</p>
              <h3 className="text-4xl font-display font-bold mt-2">{answerRate.toFixed(1)}%</h3>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl text-purple-500"><CheckSquare className="w-5 h-5"/></div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
          <h3 className="text-lg font-display font-bold mb-6">Call Volume (Last 14 Days)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeData}>
                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
                <Tooltip cursor={{fill: 'var(--muted)'}} contentStyle={{backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px'}} />
                <Bar dataKey="value" fill="currentColor" className="fill-primary" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
          <h3 className="text-lg font-display font-bold mb-6">Outcomes</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomeData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {outcomeData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px'}} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5">
        <h3 className="text-lg font-display font-bold mb-6">Top Callers</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead>Rank</TableHead>
                <TableHead>Phone Number</TableHead>
                <TableHead>Calls</TableHead>
                <TableHead>Total Duration</TableHead>
                <TableHead>Avg Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCallers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No call data available yet.
                  </TableCell>
                </TableRow>
              ) : (
                topCallers.map((caller, i) => (
                  <TableRow key={caller.number} className="border-border/50 hover:bg-muted/30 transition-colors">
                    <TableCell className="font-bold text-muted-foreground">#{i + 1}</TableCell>
                    <TableCell className="font-mono font-medium">{caller.number}</TableCell>
                    <TableCell>{caller.count}</TableCell>
                    <TableCell className="font-mono">
                      {Math.floor(caller.totalDuration / 60)}:{(caller.totalDuration % 60).toString().padStart(2, '0')}
                    </TableCell>
                    <TableCell className="font-mono">
                      {Math.round(caller.totalDuration / caller.count)}s
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
