import { useCallback, useEffect, useRef, useState } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";

import { createClient } from "../lib/client";
import { formatPhone, normalizePhone } from "../lib/phone";
import { playTone, stopTone } from "../lib/sounds";
import type {
  Appointment,
  AudioLevels,
  CallStatus,
  ServerEvent,
  TranscriptLine,
} from "../lib/types";

type Options = {
  onEvent?: (event: ServerEvent) => void;
};

function errorMessage(value: unknown): string {
  if (value && typeof value === "object") {
    const data = "data" in value ? (value as { data?: unknown }).data : value;
    if (data && typeof data === "object" && "error" in data) {
      return String((data as { error: unknown }).error);
    }
    if ("message" in value) return String((value as { message: unknown }).message);
  }
  return "Could not start the call. Check the backend and try again.";
}

export function useCall({ onEvent }: Options = {}) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [proposedPhone, setProposedPhone] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<AudioLevels>({ local: 0, remote: 0 });
  const [muted, setMuted] = useState(false);
  const [confirmation, setConfirmation] = useState<Appointment | null>(null);
  const [bookedCount, setBookedCount] = useState(0);
  const [cancelledCount, setCancelledCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const startIdRef = useRef(0);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const appendLine = useCallback((role: "user" | "agent", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((previous) => [
      ...previous,
      { id: `${Date.now()}-${Math.random()}`, role, text: clean, at: Date.now() },
    ]);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
  }, [stopTimer]);

  const handleServerMessage = useCallback((message: unknown) => {
    const wrapper = message as { data?: unknown };
    const payload = (wrapper?.data && typeof wrapper.data === "object"
      ? wrapper.data
      : wrapper) as ServerEvent;

    if (!payload?.type) return;

    if (payload.type === "caller_confirmed") {
      setVerifiedPhone(payload.formattedPhone ?? payload.phone ?? null);
    }
    if (payload.type === "appointment_created" && payload.appointment) {
      setConfirmation(payload.appointment);
      setBookedCount((value) => value + 1);
    }
    if (payload.type === "appointment_cancelled") {
      setCancelledCount((value) => value + 1);
    }
    onEventRef.current?.(payload);
  }, []);

  const start = useCallback(
    async (rawPhone: string) => {
      const digits = normalizePhone(rawPhone);
      const startId = ++startIdRef.current;

      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
      clearConnectTimeout();
      if (clientRef.current) void clientRef.current.disconnect();
      stopTimer();

      setProposedPhone(formatPhone(digits));
      setVerifiedPhone(null);
      setTranscript([]);
      setConfirmation(null);
      setSeconds(0);
      setLevels({ local: 0, remote: 0 });
      setMuted(false);
      setError(null);
      setStatus("ringing");
      playTone("ring");

      pendingRef.current = window.setTimeout(async () => {
        pendingRef.current = null;
        if (startId !== startIdRef.current) return;
        setStatus("connecting");

        connectTimeoutRef.current = window.setTimeout(() => {
          connectTimeoutRef.current = null;
          if (startId !== startIdRef.current) return;
          setError("Connection timed out. Check that the backend is running and try again.");
          setStatus("error");
          stopTimer();
          void clientRef.current?.disconnect();
        }, 20000);

        const client = createClient({
          onBotReady: () => {
            if (startId !== startIdRef.current) return;
            clearConnectTimeout();
            setStatus("connected");
            startTimer();
            playTone("connect");
          },
          onDisconnected: () => {
            if (startId !== startIdRef.current) return;
            clearConnectTimeout();
            stopTimer();
            setStatus("ended");
            playTone("end");
          },
          onError: (message) => {
            if (startId !== startIdRef.current) return;
            clearConnectTimeout();
            setError(errorMessage(message));
            setStatus("error");
            stopTimer();
          },
        });

        clientRef.current = client;

        client.on(RTVIEvent.UserInput, (data) => {
          if (data.final) appendLine("user", data.text);
        });
        client.on(RTVIEvent.BotOutput, (data) => {
          if (data.output_type !== "token") appendLine("agent", data.text);
        });
        client.on(RTVIEvent.ServerMessage, handleServerMessage);
        client.on(RTVIEvent.LocalAudioLevel, (level) => {
          setLevels((value) => ({ ...value, local: level }));
        });
        client.on(RTVIEvent.RemoteAudioLevel, (level) => {
          setLevels((value) => ({ ...value, remote: level }));
        });

        try {
          await client.startBotAndConnect({
            endpoint: "/start",
            requestData: {
              transport: "webrtc",
              enableDefaultIceServers: true,
              body: { proposed_phone: digits },
            },
          });
        } catch (cause) {
          if (startId !== startIdRef.current) return;
          clearConnectTimeout();
          setError(errorMessage(cause));
          setStatus("error");
          stopTimer();
        }
      }, 850);
    },
    [appendLine, clearConnectTimeout, handleServerMessage, startTimer, stopTimer],
  );

  const end = useCallback(() => {
    startIdRef.current += 1;
    if (pendingRef.current !== null) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
    clearConnectTimeout();
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.disconnect();
    stopTimer();
    stopTone();
    setStatus("ended");
    playTone("end");
  }, [clearConnectTimeout, stopTimer]);

  const open = useCallback(() => {
    setStatus("precall");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    end();
    setStatus("idle");
    setError(null);
    setProposedPhone(null);
    setVerifiedPhone(null);
    setTranscript([]);
    setConfirmation(null);
    setSeconds(0);
    setBookedCount(0);
    setCancelledCount(0);
  }, [end]);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const next = !muted;
    client.enableMic(!next);
    setMuted(next);
  }, [muted]);

  useEffect(() => {
    return () => {
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
      if (connectTimeoutRef.current !== null) window.clearTimeout(connectTimeoutRef.current);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      const client = clientRef.current;
      if (client) void client.disconnect();
    };
  }, []);

  return {
    status,
    proposedPhone,
    verifiedPhone,
    transcript,
    seconds,
    levels,
    muted,
    confirmation,
    bookedCount,
    cancelledCount,
    error,
    open,
    start,
    end,
    reset,
    toggleMute,
  };
}
