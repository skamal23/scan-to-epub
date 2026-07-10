from dataclasses import dataclass
from typing import Literal

RightsEvidence = Literal[
    "us_public_domain",
    "cc0",
    "cc_by",
    "cc_by_sa",
    "cc_by_nc",
    "cc_by_nc_sa",
    "cc_by_nd",
    "cc_by_nc_nd",
    "free_to_read",
    "all_rights_reserved",
    "unknown",
    "borrowed",
    "sample",
    "drm",
]
UseKind = Literal["existing_epub", "generated_epub"]
RightsOutcome = Literal["deliver", "generate", "source_only", "reject"]


@dataclass(frozen=True, slots=True)
class RightsDecision:
    outcome: RightsOutcome
    requires_attribution: bool = False
    reason: str = ""


def decide_rights(
    evidence: RightsEvidence,
    use_kind: UseKind,
    territory: str,
    preserves_sharealike: bool = True,
) -> RightsDecision:
    if territory != "US":
        return RightsDecision("reject", reason="The reviewed rights evidence is U.S.-only.")
    if evidence in {"us_public_domain", "cc0"}:
        return RightsDecision("deliver" if use_kind == "existing_epub" else "generate")
    if evidence == "cc_by":
        return RightsDecision(
            "deliver" if use_kind == "existing_epub" else "generate",
            requires_attribution=True,
        )
    if evidence == "cc_by_sa":
        if use_kind == "generated_epub" and not preserves_sharealike:
            return RightsDecision("reject", reason="ShareAlike obligations would not be preserved.")
        return RightsDecision(
            "deliver" if use_kind == "existing_epub" else "generate",
            requires_attribution=True,
        )
    if evidence == "free_to_read":
        return RightsDecision("source_only", reason="Reuse permission is not established.")
    return RightsDecision("reject", reason="The rights evidence is incompatible or insufficient.")
