package realtime

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"terra/internal/downloads"
)

func TestEventTypeMapsPersistedTransitions(t *testing.T) {
	cases := map[string]string{
		"item.started":   "job.item.started",
		"item.progress":  "job.item.progress",
		"item.completed": "job.item.completed",
		"item.skipped":   "job.item.skipped",
		"item.failed":    "job.item.failed",
		"item.retrying":  "job.item.retrying",
		"job.done":       "job.done",
		"job.progress":   "job.progress",
		"job.queued":     "job.stage",
	}
	for source, want := range cases {
		if got := eventType(source); got != want {
			t.Fatalf("eventType(%q)=%q, esperado %q", source, got, want)
		}
	}
}

func TestEventMessagePreservesItemPayloadAndRevision(t *testing.T) {
	jobID := uuid.New()
	event := downloads.JobEvent{
		ID: 42, Type: "item.started",
		Payload: map[string]any{"item_id": "item-1", "name": "documento.pdf"},
	}
	progress := &downloads.ProgressSnapshot{JobID: jobID, Status: "downloading", CompletedItems: 2}
	message := eventMessage(jobID, event, progress, 7)
	if message.Type != "job.item.started" || message.EventID != 42 || message.Revision != 7 {
		t.Fatalf("mensaje: %+v", message)
	}
	data, ok := message.Data.(map[string]any)
	if !ok || data["job_id"] != jobID || data["event_type"] != "item.started" {
		t.Fatalf("data: %+v", message.Data)
	}
	payload, ok := data["payload"].(map[string]any)
	if !ok || payload["item_id"] != "item-1" {
		t.Fatalf("payload: %+v", data["payload"])
	}
	if data["progress"] != progress {
		t.Fatalf("progreso no conservado")
	}
	if message.At.After(time.Now().Add(time.Second)) {
		t.Fatalf("timestamp inválido")
	}
}
