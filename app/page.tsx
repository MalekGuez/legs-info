"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

type SpawnTimerRow = {
  id: number | string | null;
  text: string | null;
  next_spawn: string | null;
};

type TimersState = Partial<Record<string, SpawnTimerRow>>;
type MinutesState = Record<string, number>;

const RESOURCES: Array<{ id: string; label: string; icon: string }> = [
  { id: "ressources-01", label: "Ressources-01", icon: "/pokeball.svg" },
  { id: "ressources-02", label: "Ressources-02", icon: "/pokeball.svg" },
  { id: "construction-01", label: "Construction-01", icon: "/icon.svg" },
  { id: "construction-02", label: "Construction-02", icon: "/icon.svg" },
];

const timeFormatter = Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

const defaultMinutes = 60;

const buildDefaultMinutesState = (): MinutesState =>
  RESOURCES.reduce<MinutesState>((acc, resource) => {
    acc[resource.id] = defaultMinutes;
    return acc;
  }, {});

export default function Home() {
  const [supabaseClient] = useState<SupabaseClient>(() =>
    getSupabaseBrowserClient()
  );
  const [timers, setTimers] = useState<TimersState>({});
  const [minutesToAdd, setMinutesToAdd] = useState<MinutesState>(
    buildDefaultMinutesState
  );
  const [secondsToAdd, setSecondsToAdd] = useState<Record<string, number>>(
    () =>
      RESOURCES.reduce<Record<string, number>>((acc, resource) => {
        acc[resource.id] = 0;
        return acc;
      }, {})
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  const resourceTexts = useMemo(
    () => RESOURCES.map((resource) => resource.label),
    []
  );

  const fetchTimers = useCallback(async () => {
    setError(null);
    setRefreshing(true);

    if (resourceTexts.length === 0) {
      setRefreshing(false);
      setLoading(false);
      return;
    }

    const { data, error: supabaseError } = await supabaseClient
      .from("spawn_timers")
      .select("id, text, next_spawn")
      .in("text", resourceTexts);

    if (supabaseError) {
      console.error("Supabase select error", supabaseError);
      setError(
        `Impossible de récupérer les horaires. Vérifiez votre connexion ou la configuration Supabase. Détails : ${supabaseError.message}`
      );
      setRefreshing(false);
      setLoading(false);
      return;
    }

    const fetched = (data ?? []) as SpawnTimerRow[];
    const byText = new Map<string, SpawnTimerRow>();
    fetched.forEach((row) => {
      if (row.text) {
        byText.set(row.text, row);
      }
    });

    const normalized: TimersState = {};
    RESOURCES.forEach((resource) => {
      const match = byText.get(resource.label);
      if (match) {
        normalized[resource.id] = match;
      }
    });

    setTimers(normalized);

    setRefreshing(false);
    setLoading(false);
  }, [resourceTexts, supabaseClient]);

  useEffect(() => {
    void fetchTimers();
  }, [fetchTimers]);

  const handleMinutesChange = useCallback(
    (id: string, value: string) => {
      const parsed = Number.parseInt(value, 10);
      setMinutesToAdd((prev) => ({
        ...prev,
        [id]: Number.isNaN(parsed) ? 0 : parsed,
      }));
    },
    []
  );

  const getDisplayValue = useCallback((row: SpawnTimerRow | undefined) => {
    if (!row?.next_spawn) {
      return "À redéfinir";
    }

    const date = new Date(row.next_spawn);

    if (Number.isNaN(date.getTime())) {
      return "À redéfinir";
    }

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / 60000);

    if (diffMinutes <= 0) {
      return "À redéfinir";
    }

    if (diffMinutes <= 120) {
      return diffMinutes === 1
        ? "Dans 1 minute"
        : `Dans ${diffMinutes} minutes`;
    }

    return timeFormatter.format(date);
  }, []);

  const handleAddMinutes = useCallback(
    async (id: string) => {
      const resource = RESOURCES.find((item) => item.id === id);

      if (!resource) {
        setError("Ressource inconnue.");
        return;
      }

      const minutes = minutesToAdd[id] ?? defaultMinutes;
      const seconds = secondsToAdd[id] ?? 0;

      if (!Number.isFinite(minutes) || minutes <= 0) {
        setError("Veuillez saisir un nombre de minutes supérieur à zéro.");
        return;
      }

      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 60) {
        setError("Les secondes doivent être comprises entre 0 et 59.");
        return;
      }

      setError(null);
      setUpdating((prev) => ({ ...prev, [id]: true }));

      try {
        const baseDate = new Date();
        baseDate.setSeconds(0, 0);
        const updatedDate = new Date(baseDate);
        updatedDate.setMinutes(updatedDate.getMinutes() + minutes);
        updatedDate.setSeconds(seconds);
        const nextSpawnIso = updatedDate.toISOString();

        const { data: updatedRows, error: updateError } = await supabaseClient
          .from("spawn_timers")
          .update({
            next_spawn: nextSpawnIso,
          })
          .eq("text", resource.label)
          .select("id, text, next_spawn");

        if (updateError) {
          throw new Error(updateError.message);
        }

        if (updatedRows && updatedRows.length > 0) {
          const [updatedRow] = updatedRows as SpawnTimerRow[];
          setTimers((prev) => ({
            ...prev,
            [id]: updatedRow,
          }));
          setEditing((prev) => ({ ...prev, [id]: false }));
          setMinutesToAdd((prev) => ({ ...prev, [id]: defaultMinutes }));
          setSecondsToAdd((prev) => ({ ...prev, [id]: 0 }));
          return;
        }

        const { data: insertedRows, error: insertError } = await supabaseClient
          .from("spawn_timers")
          .insert({
            text: resource.label,
            next_spawn: nextSpawnIso,
          })
          .select("id, text, next_spawn");

        if (insertError) {
          throw new Error(insertError.message);
        }

        if (insertedRows && insertedRows.length > 0) {
          const [insertedRow] = insertedRows as SpawnTimerRow[];
          setTimers((prev) => ({
            ...prev,
            [id]: insertedRow,
          }));
          setEditing((prev) => ({ ...prev, [id]: false }));
          setMinutesToAdd((prev) => ({ ...prev, [id]: defaultMinutes }));
          setSecondsToAdd((prev) => ({ ...prev, [id]: 0 }));
          return;
        }

        setError("La mise à jour n'a retourné aucune donnée.");
      } catch (caughtError) {
        console.error("Supabase update error", caughtError);
        setError(
          `La mise à jour a échoué. Veuillez réessayer ou vérifier Supabase. Détails : ${
            caughtError instanceof Error ? caughtError.message : "Erreur inconnue"
          }`
        );
      } finally {
        setUpdating((prev) => ({ ...prev, [id]: false }));
      }
    },
    [minutesToAdd, secondsToAdd, supabaseClient]
  );

  const handleToggleEdit = useCallback((id: string) => {
    setEditing((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  const handleRefresh = useCallback(async () => {
    await fetchTimers();
  }, [fetchTimers]);

  const isRowUpdating = useCallback(
    (id: string) => Boolean(updating[id]),
    [updating]
  );

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-50">
      <div className="pointer-events-none absolute inset-0">
        <Image
          src="/Background.svg"
          alt=""
          fill
          priority
          className="object-cover opacity-[0.1]"
        />
      </div>

      <main className="relative z-10 flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            CobbleGems — Legendary Info
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {refreshing ? "Actualisation..." : "Actualiser les horaires"}
            </button>
            <span className="text-xs text-zinc-500">
              Chaque bouton « Ajouter » ajoute les minutes à l&apos;horaire
              actuel.
            </span>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-zinc-400">
            Chargement des horaires...
          </div>
        ) : (
          <section className="grid gap-4">
            {RESOURCES.map((resource) => {
              const row = timers[resource.id];
              const displayValue = getDisplayValue(row);
              const minutesValue = minutesToAdd[resource.id] ?? defaultMinutes;
              const isEditing = Boolean(editing[resource.id]);

              return (
                <article
                  key={resource.id}
                  className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-4 shadow-md shadow-black/20 sm:gap-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <Image
                        src={resource.icon}
                        alt=""
                        width={28}
                        height={28}
                        className="opacity-90"
                      />
                      <div className="flex flex-col">
                        <h2 className="text-lg font-semibold text-white">
                          {row?.text ?? resource.label}
                        </h2>
                        <p className="text-sm text-zinc-400">
                          Prochain spawn estimé :{" "}
                          <span className="font-medium text-white">
                            {displayValue}
                          </span>
                          {row?.next_spawn ? (
                            <span className="text-xs text-zinc-500">
                              {" "}
                              ({timeFormatter.format(new Date(row.next_spawn))})
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleToggleEdit(resource.id)}
                      className="inline-flex items-center rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-white transition hover:border-white/40 hover:bg-white/10 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isEditing ? "Fermer" : "Modifier"}
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                      <label
                        htmlFor={`${resource.id}-minutes`}
                        className="text-sm text-zinc-300"
                      >
                        Prochaine tentative d'apparition :
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`${resource.id}-minutes`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={720}
                          value={minutesValue}
                          onChange={(event) =>
                            handleMinutesChange(resource.id, event.target.value)
                          }
                          className="h-9 w-20 rounded-md border border-white/20 bg-black/40 px-2 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/20"
                        />
                        <span className="text-sm text-zinc-400">min</span>
                        <input
                          id={`${resource.id}-seconds`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={59}
                          value={secondsToAdd[resource.id] ?? 0}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            setSecondsToAdd((prev) => ({
                              ...prev,
                              [resource.id]: Number.isNaN(parsed) ? 0 : parsed,
                            }));
                          }}
                          className="h-9 w-16 rounded-md border border-white/20 bg-black/40 px-2 text-sm text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/20"
                        />
                        <span className="text-sm text-zinc-400">sec</span>
                        <button
                          onClick={() => handleAddMinutes(resource.id)}
                          disabled={isRowUpdating(resource.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-lime-400 text-zinc-950 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                          aria-label="Enregistrer le prochain spawn"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
