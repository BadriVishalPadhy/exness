"use client";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export default function SigninPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const handleSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("http://localhost:8000/api/v1/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Check your server console for the magic link!");
      } else {
        setMessage(data.message || "Something went wrong");
      }
    } catch (err) {
      setMessage("Failed to connect to server");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-card p-8 shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground">
            Sign in
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email to receive a magic link
          </p>
        </div>
        <form onSubmit={handleSignin} className="mt-8 space-y-6">
          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            Sign in with Email
          </Button>
        </form>
        {message && (
          <p className="mt-4 text-center text-sm text-green-500">{message}</p>
        )}
      </div>
    </div>
  );
}
