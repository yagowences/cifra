/** Esqueleto em surface-sunken, sem animação de brilho. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-4">
      <div className="h-8 w-40 rounded-xs bg-surface-sunken" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-16 rounded-lg bg-surface-sunken" />
      ))}
    </div>
  );
}
