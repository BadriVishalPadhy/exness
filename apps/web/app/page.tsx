import Link from "next/link";
import { Button } from "../components/ui/button";

export default function Home() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground gap-8">
      <h1 className="text-5xl font-extrabold tracking-tight lg:text-6xl text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-600">
        Exness Pro
      </h1>
      <p className="text-xl text-muted-foreground">
        Professional Crypto Trading Terminal
      </p>
      <div className="flex gap-4">
        <Link href="/signin">
          <Button size="lg" variant="outline">Sign In</Button>
        </Link>
        <Link href="/trade">
          <Button size="lg">Start Trading</Button>
        </Link>
      </div>
    </div>
  );
}
