import type { Lead } from "@/lib/supabase";

const duration = (milliseconds: number | null) => {
  if (milliseconds === null) return "Sem conclusões";
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
};
export default function ServicePerformance({ leads }: { leads: Lead[] }) {
  const services = [
    { id: "uber", label: "Cadastro na Uber", color: "#00874e" },
    { id: "documento", label: "Documento do carro", color: "#5382df" },
  ].map((service) => {
    const rows = leads.filter((lead) => lead.service === service.id);
    const times = rows
      .filter((lead) => lead.finished_at)
      .map(
        (lead) => Date.parse(lead.finished_at!) - Date.parse(lead.created_at),
      )
      .filter((time) => Number.isFinite(time) && time >= 0);
    return {
      ...service,
      count: rows.length,
      completed: times.length,
      average: times.length
        ? times.reduce((sum, time) => sum + time, 0) / times.length
        : null,
    };
  });
  const total = services.reduce((sum, service) => sum + service.count, 0);
  const percentage = total ? (services[0].count / total) * 100 : 0;
  return (
    <section className="panel servicePerformance">
      <div className="panelHeading">
        <div>
          <h2>Desempenho de serviços</h2>
          <p className="muted">Volume e tempo de conclusão de cada serviço</p>
        </div>
      </div>
      <div className="serviceChartLayout">
        <div
          className="serviceDonut"
          role="img"
          aria-label={`${services[0].count} cadastros na Uber e ${services[1].count} documentos do carro`}
          style={{
            background: total
              ? `conic-gradient(#00874e 0% ${percentage}%, #5382df ${percentage}% 100%)`
              : "#e7ecef",
          }}
        >
          <div className="donutCenter">
            <strong>{total}</strong>
            <span>serviços</span>
          </div>
        </div>
        <div className="serviceLegend">
          {services.map((service) => (
            <div className="serviceSummary" key={service.id}>
              <div className="serviceTitle">
                <span
                  className="legendDot"
                  style={{ background: service.color }}
                />
                <strong>{service.label}</strong>
                <b>{service.count}</b>
              </div>
              <div className="serviceDetails">
                <span>
                  {total ? ((service.count / total) * 100).toFixed(0) : "0"}% do
                  volume
                </span>
                <span>
                  Tempo médio: <strong>{duration(service.average)}</strong>
                </span>
              </div>
              <small>
                {service.completed} concluídos · tempo da entrada até a
                finalização
              </small>
            </div>
          ))}
        </div>
      </div>
      {leads.some((lead) => lead.service === "desconhecido") && (
        <p className="muted">
          Serviços ainda não identificados ficam fora desta comparação.
        </p>
      )}
    </section>
  );
}
