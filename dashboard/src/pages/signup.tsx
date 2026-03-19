import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useSignup } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { getGetMeQueryKey } from "@/api-client";

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  
  const signup = useSignup();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    
    try {
      await signup.mutateAsync({ data: { name, email, password } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setLocation("/setup");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      toast({ 
        title: "Signup Failed", 
        description: message, 
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-16 h-16 mx-auto mb-4 rounded-xl shadow-lg shadow-primary/20" />
          <h1 className="text-3xl font-display font-bold text-foreground">Create your account</h1>
          <p className="text-muted-foreground mt-2">Get started with Vocalize.ai today.</p>
        </div>

        <Card className="p-8 border-border/50 shadow-2xl shadow-black/50 bg-card/80 backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Full Name</label>
              <Input 
                value={name} 
                onChange={e => setName(e.target.value)} 
                required 
                className="bg-background/50 h-12 rounded-xl"
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Work Email</label>
              <Input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                required 
                className="bg-background/50 h-12 rounded-xl"
                placeholder="jane@company.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Password</label>
              <Input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required 
                className="bg-background/50 h-12 rounded-xl"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Confirm Password</label>
              <Input 
                type="password" 
                value={confirm} 
                onChange={e => setConfirm(e.target.value)} 
                required 
                className="bg-background/50 h-12 rounded-xl"
                placeholder="••••••••"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-semibold rounded-xl bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 transition-all duration-200"
              disabled={signup.isPending}
            >
              {signup.isPending ? "Creating account..." : "Create Account"}
            </Button>
          </form>

          <p className="mt-8 text-center text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
              Sign in
            </Link>
          </p>
        </Card>
      </motion.div>
    </div>
  );
}
