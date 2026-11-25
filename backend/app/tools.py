from __future__ import annotations

from typing import Any

from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.services.llm_service import FunctionCallParams

from . import db
from .dates import resolve_date
from .models import AppResources
from .phone import format_phone, normalize_phone, speakable_phone


async def _emit(params: FunctionCallParams, message_type: str, **payload: Any) -> None:
    frame = RTVIServerMessageFrame(data={"type": message_type, **payload})
    worker = getattr(params, "pipeline_worker", None)
    if worker is None:
        resources: AppResources | None = getattr(params, "app_resources", None)
        worker = getattr(resources, "worker", None) if resources else None
    if worker is not None:
        await worker.queue_frame(frame)


def _resources(params: FunctionCallParams) -> AppResources:
    resources = getattr(params, "app_resources", None)
    if resources is None:
        raise RuntimeError("Call resources are not configured.")
    return resources


async def check_doctor_availability(
    params: FunctionCallParams,
    doctor: str = "",
    date: str = "",
):
    """Check real appointment availability for doctors.

    Args:
        doctor: Optional doctor name, specialty, or id, e.g. "Mehta" or "d1". Leave empty for all doctors.
        date: Optional date as YYYY-MM-DD, "today", or "tomorrow". Leave empty for the next three days.
    """
    slots = db.available_slots(doctor=doctor, day=date)
    grouped: dict[str, list[dict]] = {}
    for slot in slots:
        grouped.setdefault(slot.doctor_name, []).append(
            {
                "slot_id": slot.slot_id,
                "time": slot.time,
                "date": slot.date,
            }
        )
    await params.result_callback(
        {
            "ok": True,
            "resolved_date": resolve_date(date),
            "doctors": [
                {"name": name, "available_slots": values[:8]}
                for name, values in grouped.items()
            ],
            "total_available": len(slots),
        }
    )


async def set_caller_phone(params: FunctionCallParams, phone: str):
    """Set or correct the phone number the caller gave.

    Args:
        phone: The phone number the caller spoke, in any format.
    """
    resources = _resources(params)
    try:
        digits = normalize_phone(phone)
    except ValueError as exc:
        await params.result_callback({"ok": False, "error": str(exc)})
        return

    resources.state.proposed_phone = digits
    resources.state.confirmed_phone = None
    await params.result_callback(
        {
            "ok": True,
            "phone": digits,
            "formatted": format_phone(digits),
            "spoken": speakable_phone(digits),
        }
    )


async def confirm_caller_phone(params: FunctionCallParams):
    """Confirm the proposed phone number after the caller says yes out loud.

    Call this only after repeating the number back and receiving explicit verbal
    confirmation. It takes no arguments.
    """
    resources = _resources(params)
    digits = resources.state.proposed_phone
    if not digits:
        await params.result_callback(
            {"ok": False, "error": "Ask the caller for their phone number first."}
        )
        return

    resources.state.confirmed_phone = digits
    formatted = format_phone(digits)
    await _emit(params, "caller_confirmed", phone=digits, formattedPhone=formatted)
    await params.result_callback(
        {"ok": True, "confirmed": True, "phone": digits, "formatted": formatted}
    )


async def book_appointment(params: FunctionCallParams, slot_id: str):
    """Book an available appointment slot for the confirmed caller.

    Args:
        slot_id: The slot id returned by check_doctor_availability.
    """
    resources = _resources(params)
    phone = resources.state.confirmed_phone
    if not phone:
        await params.result_callback(
            {
                "ok": False,
                "error": "Ask the caller to say and confirm their phone number before booking.",
            }
        )
        return

    try:
        appointment = db.create_appointment(slot_id, phone)
    except ValueError as exc:
        await params.result_callback({"ok": False, "error": str(exc)})
        return

    payload = appointment.to_dict()
    await _emit(params, "appointment_created", appointment=payload)
    await params.result_callback(
        {
            "ok": True,
            "appointment": payload,
            "confirmation": db.appointment_summary(appointment),
        }
    )


async def cancel_appointment(params: FunctionCallParams, appointment_id: str = ""):
    """Cancel the confirmed caller's appointment.

    Args:
        appointment_id: Optional appointment id returned by check_caller_appointments. Leave empty when the caller has only one appointment.
    """
    resources = _resources(params)
    phone = resources.state.confirmed_phone
    if not phone:
        await params.result_callback(
            {
                "ok": False,
                "error": "Ask the caller to say and confirm their phone number before cancelling.",
            }
        )
        return

    active = db.active_appointments_for_phone(phone)
    if not active:
        await params.result_callback(
            {"ok": False, "error": "No active appointments were found for that number."}
        )
        return

    if appointment_id:
        target = next((item for item in active if item.id == appointment_id), None)
        if target is None:
            await params.result_callback(
                {"ok": False, "error": "That appointment was not found for this number."}
            )
            return
    elif len(active) > 1:
        await params.result_callback(
            {
                "ok": False,
                "needs_choice": True,
                "appointments": [item.to_dict() for item in active],
                "error": "The caller has more than one appointment. Ask which date and time to cancel, then call this tool with the appointment id.",
            }
        )
        return
    else:
        target = active[0]

    cancelled = db.cancel_appointment(target.id, phone)
    if not cancelled:
        await params.result_callback(
            {"ok": False, "error": "That appointment could not be cancelled."}
        )
        return

    payload = cancelled.to_dict()
    await _emit(params, "appointment_cancelled", appointment=payload)
    await params.result_callback(
        {
            "ok": True,
            "appointment": payload,
            "confirmation": db.appointment_summary(cancelled),
        }
    )


async def check_caller_appointments(params: FunctionCallParams):
    """List the confirmed caller's active appointments.

    Call this before cancelling when the caller does not give an appointment id.
    It takes no arguments.
    """
    resources = _resources(params)
    phone = resources.state.confirmed_phone
    if not phone:
        await params.result_callback(
            {
                "ok": False,
                "error": "Ask the caller to say and confirm their phone number first.",
            }
        )
        return

    active = db.active_appointments_for_phone(phone)
    await params.result_callback(
        {
            "ok": True,
            "appointments": [item.to_dict() for item in active],
            "count": len(active),
        }
    )


TOOLS = (
    check_doctor_availability,
    set_caller_phone,
    confirm_caller_phone,
    check_caller_appointments,
    book_appointment,
    cancel_appointment,
)
