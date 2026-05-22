import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mb-8 flex flex-col gap-1">
      <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
      {subtitle && <p className="text-sm text-ink-400">{subtitle}</p>}
    </header>
  );
}

export function Placeholder({
  title,
  subtitle,
  hint,
}: {
  title: string;
  subtitle?: string;
  hint?: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card hover>
        <CardHeader>
          <CardTitle>Em construção</CardTitle>
          <CardDescription>
            {hint ?? "Esta seção será implementada nos próximos módulos."}
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
