import DashboardGate from "@/components/dashboard/DashboardGate";

export const runtime = "nodejs";

export default function MeshQualityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardGate href="/mesh-quality">{children}</DashboardGate>;
}
