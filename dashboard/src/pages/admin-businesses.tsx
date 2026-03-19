import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ArrowUpDown, Pencil } from "lucide-react";
import type { Business } from "@/api-client";
import { BusinessEditDialog } from "@/components/admin/business-edit-dialog";

type SortKey = "name" | "did" | "owner_id" | "active" | "created_at";
type SortDir = "asc" | "desc";

export default function AdminBusinesses() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editBusiness, setEditBusiness] = useState<Business | null>(null);

  const { data: businesses, isLoading } = useQuery<Business[]>({
    queryKey: ["admin", "businesses"],
    queryFn: async () => {
      const res = await fetch("/api/admin/businesses", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch businesses");
      const data = await res.json();
      return Array.isArray(data) ? data : data.items ?? data.businesses ?? [];
    },
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    if (!businesses) return [];
    const q = search.toLowerCase();
    let result = businesses.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.did.toLowerCase().includes(q) ||
        b.owner_id.toLowerCase().includes(q)
    );
    result.sort((a, b) => {
      let cmp = 0;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "boolean" && typeof bv === "boolean") {
        cmp = av === bv ? 0 : av ? -1 : 1;
      } else if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [businesses, search, sortKey, sortDir]);

  const SortButton = ({ label, col }: { label: string; col: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 -ml-3 font-medium"
      onClick={() => toggleSort(col)}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
    </Button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Admin — Businesses
        </h1>
        <p className="text-muted-foreground mt-1">
          View and manage all registered businesses.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, DID, or owner ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton label="Business Name" col="name" />
                </TableHead>
                <TableHead>
                  <SortButton label="DID" col="did" />
                </TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>
                  <SortButton label="Active" col="active" />
                </TableHead>
                <TableHead>
                  <SortButton label="Created" col="created_at" />
                </TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-12"
                  >
                    {search
                      ? "No businesses match your search."
                      : "No businesses found."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((biz) => (
                  <TableRow key={biz.id}>
                    <TableCell className="font-medium">{biz.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {biz.did}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{(biz as any).owner_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{(biz as any).owner_email ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={biz.active ? "default" : "secondary"}
                        className={
                          biz.active
                            ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/20"
                            : ""
                        }
                      >
                        {biz.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(biz.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditBusiness(biz)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {editBusiness && (
        <BusinessEditDialog
          business={editBusiness}
          open={!!editBusiness}
          onOpenChange={(open) => {
            if (!open) setEditBusiness(null);
          }}
        />
      )}
    </div>
  );
}
