import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Phone, Loader2, CheckCircle2, MapPin } from "lucide-react";

interface AvailableNumber {
  phone_number: string;
  monthly_cost: string;
  upfront_cost: string;
  features: string[];
  region: string;
}

interface TelnyxNumberPickerProps {
  onNumberSelected: (phoneNumber: string) => void;
  businessId?: string | null;
}

function formatPhone(num: string): string {
  const digits = num.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return num;
}

export function TelnyxNumberPicker({ onNumberSelected, businessId }: TelnyxNumberPickerProps) {
  const [open, setOpen] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSearch = useCallback(async () => {
    if (!/^\d{3}$/.test(areaCode)) {
      setError("Enter a valid 3-digit area code (e.g. 512, 415, 212)");
      return;
    }

    setSearching(true);
    setError(null);
    setNumbers([]);

    try {
      const resp = await fetch(`/api/telnyx/numbers/search?area_code=${areaCode}&limit=20`, {
        credentials: "include",
      });
      const data = await resp.json();

      if (!resp.ok) {
        setError(data.detail || "Search failed");
        return;
      }

      if (!data.numbers || data.numbers.length === 0) {
        setError("No numbers available in this area code. Try a different one.");
        return;
      }

      setNumbers(data.numbers);
    } catch {
      setError("Failed to search for numbers. Please try again.");
    } finally {
      setSearching(false);
    }
  }, [areaCode]);

  const handlePurchase = useCallback(async (phoneNumber: string) => {
    if (!window.confirm(`Purchase ${formatPhone(phoneNumber)}? This will set it as your business phone number.`)) {
      return;
    }

    setPurchasing(phoneNumber);

    try {
      const resp = await fetch("/api/telnyx/numbers/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone_number: phoneNumber,
          business_id: businessId || undefined,
        }),
      });

      const data = await resp.json();

      if (!resp.ok && resp.status !== 207) {
        toast({ title: "Purchase Failed", description: data.detail || "Could not purchase number", variant: "destructive" });
        return;
      }

      if (data.status === "purchased_but_did_update_failed") {
        toast({ title: "Number Purchased", description: `${formatPhone(phoneNumber)} was purchased but the DID update failed. Please save it manually.`, variant: "destructive" });
      } else {
        toast({ title: "Number Purchased!", description: `${formatPhone(phoneNumber)} is now your business number.` });
      }
      onNumberSelected(phoneNumber);
      setOpen(false);
      setNumbers([]);
      setAreaCode("");
    } catch {
      toast({ title: "Purchase Failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setPurchasing(null);
    }
  }, [businessId, onNumberSelected, toast]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="gap-2">
          <Phone className="w-4 h-4" />
          Find a Number on Telnyx
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Search Available Numbers
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mt-2">
          <Input
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="Area code (e.g. 512)"
            className="font-mono flex-1"
            maxLength={3}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          <Button onClick={handleSearch} disabled={searching} className="gap-2 shrink-0">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}

        {numbers.length > 0 && (
          <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
            <p className="text-sm text-muted-foreground mb-2">{numbers.length} numbers found</p>
            {numbers.map((n) => (
              <div
                key={n.phone_number}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50 hover:border-primary/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold text-sm">{formatPhone(n.phone_number)}</div>
                  <div className="flex items-center gap-3 mt-1">
                    {n.region && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {n.region}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ${n.monthly_cost}/mo
                    </span>
                    {n.features.includes("sms") && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">SMS</span>
                    )}
                    {n.features.includes("voice") && (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-medium">Voice</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handlePurchase(n.phone_number)}
                  disabled={purchasing !== null}
                  className="ml-3 shrink-0 gap-1"
                >
                  {purchasing === n.phone_number ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Select
                </Button>
              </div>
            ))}
          </div>
        )}

        {!searching && numbers.length === 0 && !error && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Enter an area code and click Search to find available phone numbers.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
