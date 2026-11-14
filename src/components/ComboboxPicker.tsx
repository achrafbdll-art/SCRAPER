import { useEffect, useId, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';

export interface ComboboxOption<T> {
  key: string;
  label: string;
  sublabel?: string;
  value: T;
}

interface ComboboxPickerProps<T> {
  label: string;
  placeholder: string;
  options: ComboboxOption<T>[];
  selected: ComboboxOption<T>[];
  onSelect: (option: ComboboxOption<T>) => void;
  onRemove: (key: string) => void;
  onQueryChange: (query: string) => void;
  allowCustom?: boolean;
  onAddCustom?: (raw: string) => Promise<void> | void;
  customActionLabel?: string;
  icon?: 'search' | 'pin';
  loading?: boolean;
}

export function ComboboxPicker<T>({
  label,
  placeholder,
  options,
  selected,
  onSelect,
  onRemove,
  onQueryChange,
  allowCustom = false,
  onAddCustom,
  customActionLabel = 'Add',
  loading = false,
}: ComboboxPickerProps<T>) {
  const inputId = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [submittingCustom, setSubmittingCustom] = useState(false);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const selectedKeys = new Set(selected.map((s) => s.key));
  const available = options.filter((o) => !selectedKeys.has(o.key));

  const handleInput = (val: string) => {
    setQuery(val);
    setActiveIndex(0);
    setOpen(true);
    onQueryChange(val);
  };

  const commitOption = (opt: ComboboxOption<T>) => {
    onSelect(opt);
    setQuery('');
    onQueryChange('');
    setOpen(false);
    setActiveIndex(0);
  };

  const commitCustom = async () => {
    const trimmed = query.trim();
    if (!trimmed || !onAddCustom) return;
    setSubmittingCustom(true);
    try {
      await onAddCustom(trimmed);
      setQuery('');
      onQueryChange('');
      setOpen(false);
    } finally {
      setSubmittingCustom(false);
    }
  };

  return (
    <div ref={containerRef} className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-900">
        {label}
      </label>

      <div className="relative">
        <div className="flex items-center rounded-lg border border-slate-300 bg-white px-3 transition-colors focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/15">
          <Search className="mr-2.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActiveIndex((i) => Math.min(i + 1, Math.max(0, available.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (open && available[activeIndex]) {
                  commitOption(available[activeIndex]);
                } else if (allowCustom && query.trim()) {
                  void commitCustom();
                }
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="h-10 w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {loading && (
            <span className="ml-2 text-xs text-slate-400 whitespace-nowrap">Searching</span>
          )}
        </div>

        {open && (available.length > 0 || (allowCustom && query.trim())) && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {available.slice(0, 20).map((opt, idx) => (
              <li key={opt.key} role="option" aria-selected={idx === activeIndex}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commitOption(opt)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                    idx === activeIndex ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate font-medium">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="ml-3 shrink-0 font-mono text-xs text-slate-400 tabular-nums">
                      {opt.sublabel}
                    </span>
                  )}
                </button>
              </li>
            ))}

            {allowCustom && query.trim() && (
              <li className="border-t border-slate-100 mt-1 pt-1">
                <button
                  type="button"
                  disabled={submittingCustom}
                  onClick={() => void commitCustom()}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {submittingCustom ? 'Looking up location...' : `${customActionLabel}: "${query.trim()}"`}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {selected.map((item) => (
            <span
              key={item.key}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800"
            >
              <span className="truncate max-w-[220px]">{item.label}</span>
              <button
                type="button"
                aria-label={`Remove ${item.label}`}
                onClick={() => onRemove(item.key)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
