import { Minus, Plus } from "lucide-react";

interface QuantityControlProps {
  value: number;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function QuantityControl({
  value,
  min = 1,
  max,
  disabled = false,
  onChange,
}: QuantityControlProps) {
  const setValue = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div className="cart-quantity-control" aria-label="Số lượng">
      <button
        type="button"
        onClick={() => setValue(value - 1)}
        disabled={disabled || value <= min}
        aria-label="Giảm số lượng"
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        aria-label="Số lượng"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next)) setValue(next);
        }}
      />
      <button
        type="button"
        onClick={() => setValue(value + 1)}
        disabled={disabled || value >= max}
        aria-label="Tăng số lượng"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
