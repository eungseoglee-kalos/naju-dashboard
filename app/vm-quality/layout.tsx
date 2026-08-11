import DashboardGate from "@/components/dashboard/DashboardGate";

export const runtime = "nodejs";

export default function VmQualityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardGate href="/vm-quality">{children}</DashboardGate>;
}
