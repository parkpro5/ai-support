import { STATUS_COLORS, STATUS_LABELS } from '../../constants/requestLabels';

export default function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.SUBMITTED;
  return (
    <span
      style={{
        ...colors,
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: '0.8rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
