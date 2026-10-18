"""Tests for xreview. Run from this directory: python3 -m unittest test_xreview"""

import datetime as dt
import io
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import xreview
from xreview import (
    AgentError,
    Cancelled,
    ClaudeAgent,
    Orchestrator,
    PiAgent,
    PlanRef,
    RunLog,
    Status,
    StatusError,
    Verifier,
    cancel_run,
    declared_findings,
    dispositions,
    duration,
    finding_ids,
    load_brief,
    make_echo,
    next_finding_id,
    parse_claude_output,
    parse_status,
    relay,
    render_details,
    render_final,
    render_verify,
    run_cli,
    run_status,
    run_times,
)

SCRIPT = Path(__file__).with_name("xreview.py")


def block(status="open", blocking=(), non_blocking=(), changed=(), question=None, verdicts=()):
    data = {
        "status": status,
        "blocking": [{"item": i, "position": f"hold {i}", "evidence": "x"} for i in blocking],
        "non_blocking": [{"item": i, "note": f"note {i}"} for i in non_blocking],
        "changed_positions": list(changed),
        "question": question,
    }
    if verdicts:
        data["verdicts"] = [{"item": item, "verdict": verdict} for item, verdict in verdicts]
    return f"```xreview-status\n{json.dumps(data)}\n```"


def reply(body, **status):
    return f"{body}\n\n{block(**status)}"


def status_text(data):
    return f"```xreview-status\n{json.dumps(data)}\n```"


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def wait_until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


class FakeAgent:
    """Returns scripted replies in order and records every prompt. A callable
    item is called with no arguments and its result used as the reply; a
    (text, meta) tuple also supplies the turn's metadata."""

    def __init__(self, kind, replies):
        self.kind = kind
        self.replies = list(replies)
        self.prompts = []
        self.lock = threading.Lock()

    def send(self, prompt):
        with self.lock:
            self.prompts.append(prompt)
            if not self.replies:
                raise AssertionError(f"{self.kind}: unexpected extra turn")
            item = self.replies.pop(0)
        if callable(item):
            item = item()
        if isinstance(item, BaseException):
            raise item
        return item if isinstance(item, tuple) else (item, {})

    def resume_hint(self):
        return f"resume {self.kind}"


class ParseStatusTest(unittest.TestCase):
    def test_parses_block_and_defaults_missing_lists(self):
        status = parse_status('Findings.\n\n```xreview-status\n{"status": "agree"}\n```\n')
        self.assertEqual(Status("agree"), status)
        self.assertTrue(status.agrees)

    def test_terminal_block_wins_over_earlier_ones(self):
        text = reply("first", status="open", blocking=["U1"]) + "\n" + block(status="agree")
        self.assertTrue(parse_status(text).agrees)

    def test_rejects_prose_after_the_block(self):
        with self.assertRaisesRegex(StatusError, "must be the last thing"):
            parse_status(block(status="agree") + "\n\nI still object to U1.")

    def test_normalizes_blocking_ids(self):
        text = status_text({"status": "open", "blocking": [{"item": " u3 ", "position": "p"}]})
        self.assertEqual(frozenset({"U3"}), parse_status(text).blocking_ids())

    def test_agree_with_blocking_items_does_not_count_as_agreement(self):
        self.assertFalse(parse_status(block(status="agree", blocking=["U1"])).agrees)

    def test_rejects_missing_block(self):
        with self.assertRaisesRegex(StatusError, "no ```xreview-status block"):
            parse_status("Just prose.")

    def test_rejects_invalid_json(self):
        with self.assertRaisesRegex(StatusError, "not valid JSON"):
            parse_status("```xreview-status\n{status: open}\n```")

    def test_rejects_unknown_status(self):
        with self.assertRaisesRegex(StatusError, "status must be one of"):
            parse_status(status_text({"status": "done"}))

    def test_rejects_non_object_entries(self):
        with self.assertRaisesRegex(StatusError, "blocking must be a list of objects"):
            parse_status(status_text({"status": "open", "blocking": ["U1"]}))

    def test_rejects_entries_missing_required_fields(self):
        cases = {
            "missing item": {"blocking": [{"position": "p"}]},
            "missing position": {"blocking": [{"item": "U1"}]},
            "missing note": {"non_blocking": [{"item": "U1"}]},
            "missing reason": {"changed_positions": [{"item": "U1", "from": "a", "to": "b"}]},
        }
        for name, fields in cases.items():
            with self.subTest(name), self.assertRaisesRegex(StatusError, "missing"):
                parse_status(status_text({"status": "open", **fields}))

    def test_rejects_entry_fields_that_are_not_non_empty_strings(self):
        entries = {
            "blocking": {"item": "U1", "position": "hold"},
            "non_blocking": {"item": "U1", "note": "note"},
            "changed_positions": {"item": "U1", "from": "a", "to": "b", "reason": "evidence"},
        }
        for key, entry in entries.items():
            for field in entry:
                for value in (42, True, ["text"], {"text": "value"}, None, "", "  "):
                    with self.subTest(key=key, field=field, value=value):
                        with self.assertRaisesRegex(StatusError, "must be a non-empty string"):
                            parse_status(status_text({"status": "open", key: [{**entry, field: value}]}))

    def test_rejects_non_list_fields_even_when_empty(self):
        for key in ("blocking", "non_blocking", "changed_positions"):
            for value in (False, 0, "", {}, None):
                with self.subTest(key=key, value=value):
                    with self.assertRaisesRegex(StatusError, "must be a list of objects"):
                        parse_status(status_text({"status": "open", key: value}))

    def test_parses_verdicts_and_rejects_unknown_ones(self):
        status = parse_status(block(status="agree", verdicts=[("u1", "Implemented"), ("U2", "deviates")]))
        self.assertEqual(["u1", "U2"], [entry["item"] for entry in status.verdicts])
        with self.assertRaisesRegex(StatusError, "verdicts.verdict must be one of"):
            parse_status(block(verdicts=[("U1", "done")]))
        with self.assertRaisesRegex(StatusError, "missing verdict"):
            parse_status(status_text({"status": "open", "verdicts": [{"item": "U1"}]}))

    def test_needs_human_requires_a_question(self):
        with self.assertRaisesRegex(StatusError, "requires a question"):
            parse_status(status_text({"status": "needs_human"}))


class RelayTest(unittest.TestCase):
    def test_renames_status_blocks_so_they_cannot_be_parsed(self):
        relayed = relay(reply("Review.", status="agree"))
        self.assertIn("```peer-status", relayed)
        self.assertNotIn("```xreview-status", relayed)
        with self.assertRaises(StatusError):
            parse_status(relayed)


class FindingIdsTest(unittest.TestCase):
    def test_reads_ids_outside_the_status_block_and_filters_by_reviewer(self):
        text = reply("A1 and B2, then A10; not B2B or A4x.", non_blocking=["A7"])
        self.assertEqual({"A1", "B2", "A10"}, finding_ids(text))
        self.assertEqual({"A1", "A10"}, finding_ids(text, "A"))

    def test_declared_findings_start_a_line_and_prose_mentions_do_not_count(self):
        text = reply("### A1 · Major\n- **A2**: x\n| A3 | keep |\n1. **A4.** y\n**A5. Minor:** z\n"
                     "None new; no separate A6 finding.\nA7 and A8, then B1.\n", non_blocking=["A9"])
        self.assertEqual({"A1", "A2", "A3", "A4", "A5", "A7"}, declared_findings(text, "A"))
        self.assertEqual({"B1"}, declared_findings("### B1 — Moderate\nAccept A1.\n", "B"))

    def test_next_id_continues_the_reviewers_numbering(self):
        self.assertEqual("A11", next_finding_id("### A1 ... ### A10 ... ### A2", "A"))
        self.assertEqual("B1", next_finding_id("No findings; A3 is not mine.", "B"))

    def test_dispositions_section_ends_at_the_next_heading_or_unresolved(self):
        heading = "## Dispositions\n- A1 → U1\n- B1 merged into U1\n\n## Unresolved\n- A2 disputed\n"
        inline = "**Dispositions:** A1 → U1; A2 withdrawn\n**Unresolved:** B3, none\n"
        self.assertEqual({"A1", "B1"}, finding_ids(dispositions(heading)))
        self.assertEqual({"A1", "A2"}, finding_ids(dispositions(inline)))
        self.assertIsNone(dispositions("U1 · Fix A1"))


class CommandTest(unittest.TestCase):
    def test_claude_first_call_names_session_and_stays_read_only(self):
        cmd = ClaudeAgent(cwd=Path("/w"), name="xreview t A", model="haiku").command()
        self.assertEqual(["claude", "-p", "--output-format", "json"], cmd[:4])
        self.assertIn("--name", cmd)
        self.assertNotIn("--resume", cmd)
        self.assertEqual("dontAsk", cmd[cmd.index("--permission-mode") + 1])
        # Skill lets briefs name a skill to apply; it adds instructions, not tools.
        self.assertEqual("Read,Grep,Glob,Bash,Skill", cmd[cmd.index("--tools") + 1])
        self.assertIn("--strict-mcp-config", cmd)
        denied = cmd[cmd.index("--disallowedTools") + 1 : cmd.index("--allowedTools")]
        self.assertEqual(["Edit", "Write", "NotebookEdit", "Bash(git *--output*)"], denied)
        self.assertIn("Bash(git diff *)", cmd)

    def test_claude_later_calls_resume_the_session(self):
        cmd = ClaudeAgent(cwd=Path("/w"), name="n", session_id="abc").command()
        self.assertEqual("abc", cmd[cmd.index("--resume") + 1])
        self.assertNotIn("--name", cmd)
        self.assertIn("--tools", cmd)

    def test_pi_passes_prompt_after_double_dash_with_read_only_tools(self):
        agent = PiAgent(cwd=Path("/w"), session_id="xr-1", name="xreview t B", thinking="low")
        cmd = agent.command("- prompt")
        self.assertEqual(["--", "- prompt"], cmd[-2:])
        self.assertEqual("xr-1", cmd[cmd.index("--session-id") + 1])
        self.assertEqual(xreview.DEFAULT_PI_TOOLS, cmd[cmd.index("--tools") + 1])
        self.assertIn("--name", cmd)
        agent.started = True
        self.assertNotIn("--name", agent.command("p"))

    def test_pi_delegation_is_limited_to_read_only_agents(self):
        self.assertEqual({"PI_SUBAGENT_INHERITED_APPROVAL_SCOPE": "read-only"}, xreview.PI_READ_ONLY_ENV)


class ParseClaudeOutputTest(unittest.TestCase):
    def test_returns_text_and_session(self):
        out = json.dumps({"subtype": "success", "is_error": False, "result": "Hi",
                          "session_id": "s1", "total_cost_usd": 0.5, "num_turns": 3})
        text, meta = parse_claude_output(out, "", 0)
        self.assertEqual("Hi", text)
        self.assertEqual("s1", meta["session_id"])
        self.assertEqual(0.5, meta["session_cost_usd"])

    def test_reported_error_raises(self):
        out = json.dumps({"subtype": "error_max_turns", "is_error": True, "session_id": "s1"})
        with self.assertRaisesRegex(AgentError, "error_max_turns"):
            parse_claude_output(out, "", 1)

    def test_non_json_output_raises_with_stderr(self):
        with self.assertRaisesRegex(AgentError, "boom"):
            parse_claude_output("", "boom", 2)

    def test_turn_cost_is_the_increase_in_the_session_cost(self):
        """Claude reports total_cost_usd for the whole session, including earlier resumed turns."""
        def completed(total):
            out = json.dumps({"subtype": "success", "result": "r", "session_id": "s1", "total_cost_usd": total})
            return subprocess.CompletedProcess([], 0, out, "")

        agent = ClaudeAgent(cwd=Path("/w"), name="n")
        with mock.patch.object(xreview, "run_cli", side_effect=[completed(t) for t in (0.80, 1.11, 1.39, 0.2)]):
            metas = [agent.send("p")[1] for _ in range(4)]
        self.assertEqual([0.80, 0.31, 0.28, 0.2], [round(meta["cost_usd"], 2) for meta in metas])
        self.assertEqual([0.80, 1.11, 1.39, 0.2], [meta["session_cost_usd"] for meta in metas])


class RunCliTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.children = xreview.ChildProcesses()
        patcher = mock.patch.object(xreview, "CHILDREN", self.children)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_launch_failure_becomes_an_agent_error(self):
        not_executable = self.dir / "cli"
        not_executable.write_text("#!/bin/sh\n")
        not_executable.chmod(stat.S_IRUSR | stat.S_IWUSR)
        with self.assertRaisesRegex(AgentError, "could not be started"):
            run_cli([str(not_executable)], self.dir, None, 5)

    def test_timeout_stops_the_whole_process_group(self):
        pid_file = self.dir / "grandchild"
        cmd = ["sh", "-c", f"sleep 60 & echo $! > {pid_file}; wait"]
        with self.assertRaisesRegex(AgentError, "did not finish within 1s"):
            run_cli(cmd, self.dir, None, 1, grace=2)
        grandchild = int(pid_file.read_text())
        self.assertTrue(wait_until(lambda: not pid_alive(grandchild)), "grandchild still running")

    def test_passes_extra_environment(self):
        proc = run_cli(["sh", "-c", "printf %s \"$XR_TEST\""], self.dir, None, 5, env={"XR_TEST": "yes"})
        self.assertEqual("yes", proc.stdout)

    def test_closed_run_does_not_start_another_cli(self):
        self.children.close(grace=0.1)
        with mock.patch.object(xreview.subprocess, "Popen") as launch:
            with self.assertRaisesRegex(AgentError, "run is stopping"):
                run_cli(["unused-cli"], self.dir, None, 5)
        launch.assert_not_called()

    def test_close_during_launch_escalates_for_a_sigterm_resistant_cli(self):
        cmd = [sys.executable, "-c", "import signal, time; "
               "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
               "print('ready', flush=True); time.sleep(60)"]
        proc = subprocess.Popen(cmd, text=True, start_new_session=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def cleanup():
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=5)
            proc.stdout.close()
            proc.stderr.close()

        self.addCleanup(cleanup)
        self.assertEqual("ready\n", proc.stdout.readline())

        def close_before_registration(*_args, **_kwargs):
            self.children.close(grace=0.1)
            return proc

        with mock.patch.object(xreview.subprocess, "Popen", side_effect=close_before_registration):
            with self.assertRaisesRegex(AgentError, "run is stopping"):
                run_cli(cmd, self.dir, None, 0.3, grace=0.1)
        self.assertEqual(-signal.SIGKILL, proc.poll())
        self.assertEqual(set(), self.children._procs)


class OrchestratorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.run_dir = Path(self.tmp.name) / "run"
        self.messages = []
        self.children = xreview.ChildProcesses()
        patcher = mock.patch.object(xreview, "CHILDREN", self.children)
        patcher.start()
        self.addCleanup(patcher.stop)

    def orchestrate(self, a_replies, b_replies, drafter="A", max_approval_turns=3, terminate=None, report=False):
        self.a = FakeAgent("claude", a_replies)
        self.b = FakeAgent("pi", b_replies)
        log = RunLog(self.run_dir)
        orch = Orchestrator(
            agents={"A": self.a, "B": self.b},
            brief="Review SKILL.md.",
            cwd=Path("/work"),
            drafter=drafter,
            max_approval_turns=max_approval_turns,
            log=log,
            echo=self.messages.append,
            terminate=terminate,
            report=report,
        )
        outcome = orch.run()
        return outcome, orch, log

    def test_converges_on_first_approval_and_relays_verbatim(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("A-PLAN U1")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("B-OK", status="agree", non_blocking=["U1"])],
        )
        self.assertEqual("converged", outcome.result)
        self.assertEqual(1, outcome.approval_turns)
        a_prompts, b_prompts = self.a.prompts, self.b.prompts
        self.assertIn("Reviewer A", a_prompts[0])
        self.assertIn("Review SKILL.md.", b_prompts[0])
        self.assertNotIn("A-REVIEW", b_prompts[0])
        self.assertIn("B-REVIEW", a_prompts[1])
        self.assertIn("A-REVIEW", b_prompts[1])
        self.assertIn("```peer-status", b_prompts[1])
        self.assertNotIn("```xreview-status", b_prompts[1])
        self.assertIn("B-CROSS", a_prompts[2])
        self.assertIn("A-CROSS", b_prompts[2])
        self.assertIn("A-PLAN U1", b_prompts[2])
        self.assertEqual(6, len(log.turns))

        final = render_details(outcome, orch, log, "t")
        self.assertIn("Converged", final)
        self.assertIn("A-PLAN U1", final)
        self.assertIn("note U1", final)
        self.assertNotIn("```xreview-status", final)

    def test_drafter_writes_the_final_report_from_the_settled_plan(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("A-PLAN U1"),
             reply("## Findings\n\n### U1 · Major · Fix it\n- **Fix:** do x.\n"
                   "- **Remarks:** Reviewer B rates it Moderate; Reviewer A (me) rates it Major.")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("B-OK", status="agree", non_blocking=["U1"])],
            report=True,
        )
        self.assertEqual("converged", outcome.result)
        self.assertEqual("report", log.turns[-1]["phase"])
        prompt = self.a.prompts[3]
        self.assertIn("Both reviewers accepted your latest plan", prompt)
        self.assertIn("B-OK", prompt)
        self.assertIn("ordered by severity", prompt)
        self.assertIn("**Remarks:** only where the human has to decide", prompt)
        self.assertIn("Risks, caveats, and background are not remarks", prompt)
        self.assertNotIn("## Unresolved", prompt)

        final = render_final(outcome, orch, log, "t")
        self.assertIn("**Converged.**", final)
        self.assertIn("- Reviewers: Claude and Pi", final)
        self.assertIn("### U1 · Major · Fix it\n- **Fix:** do x.\n"
                      "- **Remarks:** Pi rates it Moderate; Claude (me) rates it Major.", final)
        self.assertNotRegex(final, r"Reviewer [AB]")
        self.assertIn("`details.md`", final)
        self.assertIn("resume claude", final)
        for noise in ("A-PLAN", "B-OK", "note U1", "## Turns", "Position changes", "```xreview-status"):
            self.assertNotIn(noise, final)
        details = render_details(outcome, orch, log, "t")
        self.assertIn("A-PLAN U1", details)
        self.assertIn("| 7 | Claude | report |", details)
        self.assertIn("- Finding ids: A1, A2, ... are Claude's; B1, B2, ... are Pi's", details)
        # The reviewers stay anonymous to each other: only the reports use their names.
        for prompt in self.a.prompts + self.b.prompts:
            self.assertNotRegex(prompt, r"\b(Claude|Pi)\b")

    def test_failed_report_falls_back_to_the_plan_and_its_amendments(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("A-PLAN U1"), AgentError("claude exited 1")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("B-OK", status="agree", non_blocking=["U1"])],
            report=True,
        )
        self.assertEqual("converged", outcome.result)
        final = render_final(outcome, orch, log, "t")
        self.assertIn("_No final report was written (Claude, report: claude exited 1). "
                      "This is the latest plan, by Claude._\n\nA-PLAN U1", final)
        self.assertIn("## Suggested amendments not in the plan\n\n- **U1** (Pi, turn 6, approve): note U1", final)

    def test_disputed_report_asks_for_the_unresolved_positions(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN", blocking=["U3"]),
             reply("still object", blocking=["U3"]), reply("## Findings\n\n## Unresolved\n\nU3: both views.")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("all fine", status="agree")],
            report=True,
        )
        self.assertEqual("disputed", outcome.result)
        prompt = self.a.prompts[4]
        self.assertIn("Reviewer B approved your latest plan, but you kept blocking objections", prompt)
        self.assertIn("## Unresolved", prompt)
        final = render_final(outcome, orch, log, "t")
        self.assertIn("U3: both views.", final)
        self.assertIn("## Blocking disagreements, as each reviewer stated them\n\n- **U3**\n  - Claude: hold U3 (x)",
                      final)

    def test_no_report_after_a_question(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW")],
            [reply("B?", status="needs_human", question="Which branch?")],
            report=True,
        )
        self.assertEqual("needs_human", outcome.result)
        self.assertNotIn("report", [entry["phase"] for entry in log.turns])

    def test_converges_after_one_revision(self):
        outcome, orch, _ = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN v1"), reply("PLAN v2")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("object", blocking=["U2"]),
             reply("ok", status="agree")],
        )
        self.assertEqual("converged", outcome.result)
        self.assertEqual(2, outcome.approval_turns)
        self.assertIn("object", self.a.prompts[3])
        self.assertIn("PLAN v2", self.b.prompts[3])
        self.assertIn("PLAN v2", orch.plan.text)

    def test_drafter_objection_survives_a_generic_approval(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN", blocking=["U3"]),
             reply("still object", blocking=["U3"])],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("all fine", status="agree")],
        )
        self.assertEqual("disputed", outcome.result)
        self.assertIn("U3", self.a.prompts[3])
        self.assertIn("all fine", self.a.prompts[3])
        final = render_details(outcome, orch, log, "t")
        self.assertIn("Remaining blocking disagreements", final)
        self.assertIn("hold U3", final)

    def test_drafter_can_withdraw_its_objection_after_approval(self):
        outcome, _, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN", blocking=["U3"]),
             reply("settled", status="agree")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("all fine", status="agree")],
        )
        self.assertEqual("converged", outcome.result)
        self.assertEqual("confirm", log.turns[-1]["phase"])

    def test_repeated_objections_run_to_the_cap(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("P1"),
             reply("P1 kept", blocking=["U1"]), reply("P1 kept again", blocking=["U1"])],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("no", blocking=["U1"]),
             reply("still no", blocking=["U1"]), reply("no again", blocking=["U1"])],
        )
        self.assertEqual("round_cap", outcome.result)
        self.assertEqual(3, outcome.approval_turns)
        final = render_details(outcome, orch, log, "t")
        self.assertIn("Remaining blocking disagreements", final)
        self.assertIn("hold U1", final)

    def test_superseded_notes_are_summarized_and_repeats_count_at_their_latest_turn(self):
        plan = "## Dispositions\n- A1 → U1\n- B1 → U1\n\n## Unresolved\nNone."
        moved_a2 = {"item": "A2", "from": "keep", "to": "withdraw", "reason": "r"}
        outcome, orch, log = self.orchestrate(
            [reply("A1 ... A2"), reply("A-CROSS", non_blocking=["B1", "A2"]),
             reply(f"P1\n\n{plan}", changed=[moved_a2], non_blocking=["U3"]),
             reply(f"P2\n\n{plan}", non_blocking=["U3"])],
            [reply("B1"), reply("B-CROSS", non_blocking=["A1", "SCOPE"]),
             reply("fix U1", blocking=["U1"], non_blocking=["U4"]), reply("ok", status="agree", non_blocking=["U5"])],
        )
        self.assertEqual("converged", outcome.result)
        final = render_details(outcome, orch, log, "t")
        notes = final[final.index("## Non-blocking notes"):final.index("## Unified plan")]
        self.assertIn("- **SCOPE** (Pi, turn 4, cross): note SCOPE", notes)
        self.assertIn("- **U3** (Claude, turn 7, revise): note U3", notes)
        self.assertEqual(1, final.count("note U3"))
        self.assertIn("_Not shown: 4 earlier notes that the plan or a later position change superseded "
                      "(Claude, turn 3: B1, A2; Pi, turn 4: A1; Pi, turn 6: U4). See `turns/`._",
                      notes)
        for superseded in ("note B1", "note A2", "note A1", "note U4"):
            self.assertNotIn(superseded, final)
        self.assertNotIn("note U5", notes)
        self.assertIn("note U5", final[final.index("## Suggested amendments not in the plan"):])

    def test_final_approval_and_confirmation_notes_follow_the_plan_as_amendments(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("A-PLAN", blocking=["U3"]),
             reply("settled", status="agree", non_blocking=["U6"])],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("B-OK", status="agree", non_blocking=["U2"])],
        )
        self.assertEqual("converged", outcome.result)
        final = render_details(outcome, orch, log, "t")
        plan, amendments = final.index("## Unified plan"), final.index("## Suggested amendments not in the plan")
        self.assertLess(plan, amendments)
        section = final[amendments:final.index("## Last response")]
        self.assertIn("- **U2** (Pi, turn 6, approve): note U2", section)
        self.assertIn("- **U6** (Claude, turn 7, confirm): note U6", section)
        self.assertNotIn("## Non-blocking notes", final)

    def test_report_shows_turn_costs_reviewer_totals_and_run_times(self):
        def claude(text, cost, total):
            return text, {"session_id": "s1", "cost_usd": cost, "session_cost_usd": total}

        outcome, orch, log = self.orchestrate(
            [claude(reply("A-REVIEW"), 0.80, 0.80), claude(reply("A-CROSS"), 0.31, 1.11),
             claude(reply("A-PLAN"), 0.28, 1.39)],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("ok", status="agree")],
        )
        log.started = dt.datetime(2026, 10, 18, 17, 30, 51)
        final = render_details(outcome, orch, log, "t", ended=dt.datetime(2026, 10, 18, 17, 39, 58))
        self.assertIn("- Started 2026-10-18 17:30:51, ended 17:39:58; wall time 9m07s", final)
        self.assertIn("| # | Reviewer | Phase | Time | Cost | Status | Blocking |", final)
        self.assertIn("| 3 | Claude | cross | 0s | $0.31 | open |  |", final)
        self.assertIn("| 4 | Pi | cross | 0s |  | open |  |", final)
        self.assertIn("- Claude: 3 turns, 0s, $1.39", final)
        self.assertIn("- Pi: 3 turns, 0s, cost not reported", final)
        self.assertEqual(1.11, log.turns[2]["session_cost_usd"])

    def test_report_warns_about_findings_missing_from_the_dispositions(self):
        listed = "## Dispositions\n- A1 → U1\n- A2 withdrawn\n- B1 merged into U1\n"
        cases = {
            "all listed": (f"U1\n\n{listed}- A3 rejected\n- B2 → U2\n\n## Unresolved\nNone.", None),
            "some missing": (f"U1\n\n{listed}\n## Unresolved\nNone; B2 stays out.",
                             "the latest plan's Dispositions section does not mention A3, B2."),
            "no section": ("U1 fixes A1 and B1.",
                           "the latest plan has no Dispositions section, so it does not account for A1, A2, A3, B1, B2."),
        }
        for name, (plan, warning) in cases.items():
            with self.subTest(name):
                self.run_dir = Path(self.tmp.name) / name.replace(" ", "-")
                outcome, orch, log = self.orchestrate(
                    [reply("### A1 · Major\n### A2 · Minor"), reply("Accept B1.\n\n### A3 · Minor"), reply(plan)],
                    [reply("### B1 · Moderate"), reply("Accept A1, reject A2.\n\n### B2 · Minor"),
                     reply("ok", status="agree")],
                )
                self.assertIn("from A3 on", self.a.prompts[1])
                self.assertIn("from B2 on", self.b.prompts[1])
                self.assertIn("`merged into Uk`", self.a.prompts[2])
                final = render_final(outcome, orch, log, "t")
                if warning:
                    self.assertIn(f"> **Warning:** {warning}", final)
                else:
                    self.assertNotIn("Warning", final)

    def test_report_ignores_unused_ids_mentioned_in_prose(self):
        outcome, orch, log = self.orchestrate(
            [reply("### A1 · Major"), reply("Accept B1 and B2."),
             reply("U1\n\n## Dispositions\n- A1 → U1\n- B1 → U1\n- B2 → U1\n\n## Unresolved\nNone.")],
            [reply("### B1 — Moderate\n### B2 — Minor"),
             reply("## New findings\n\nNone. The comparison produced no separate B3 finding."),
             reply("ok", status="agree")],
        )
        self.assertIn("from B3 on", self.b.prompts[1])
        self.assertNotIn("Warning", render_final(outcome, orch, log, "t"))

    def test_needs_human_stops_after_parallel_phase(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW")],
            [reply("B?", status="needs_human", question="Which branch?")],
        )
        self.assertEqual("needs_human", outcome.result)
        self.assertEqual(2, len(log.turns))
        self.assertIn("Which branch?", render_final(outcome, orch, log, "t"))

    def test_missing_status_block_is_retried_and_the_repair_relayed(self):
        outcome, _, _ = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN")],
            ["B-REVIEW without block", block(), reply("B-CROSS"), reply("ok", status="agree")],
        )
        self.assertEqual("converged", outcome.result)
        self.assertIn("did not end with a valid `xreview-status` block", self.b.prompts[1])
        self.assertIn("B-REVIEW without block", self.a.prompts[1])
        self.assertIn("```peer-status", self.a.prompts[1])

    def test_numeric_note_is_repaired_before_final_report_generation(self):
        malformed = status_text({"status": "agree", "non_blocking": [{"item": "U1", "note": 42}]})
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN")],
            [reply("B-REVIEW"), reply("B-CROSS"), f"Approved.\n\n{malformed}",
             block(status="agree", non_blocking=["U1"])],
        )
        self.assertEqual("converged", outcome.result)
        self.assertIn("note U1", render_details(outcome, orch, log, "t"))
        self.assertIn("must be a non-empty string", self.b.prompts[3])

    def test_second_missing_status_block_is_a_protocol_error(self):
        outcome, _, _ = self.orchestrate([reply("A-REVIEW")], ["no block", "still no block"])
        self.assertEqual("protocol_error", outcome.result)
        self.assertIn("Reviewer B", outcome.detail)

    def test_agent_failure_stops_the_run(self):
        outcome, orch, log = self.orchestrate([reply("A-REVIEW")], [AgentError("pi exited 1")])
        self.assertEqual("error", outcome.result)
        self.assertIn("pi exited 1", outcome.detail)
        self.assertIn("No unified plan", render_final(outcome, orch, log, "t"))

    def test_failed_turn_stops_the_parallel_sibling(self):
        released = threading.Event()

        def blocked_until_terminated():
            released.wait(timeout=5)
            return AgentError("terminated")

        outcome, _, _ = self.orchestrate(
            [AgentError("claude exited 1")], [blocked_until_terminated], terminate=released.set)
        self.assertTrue(released.is_set())
        self.assertEqual("error", outcome.result)
        self.assertIn("claude exited 1", outcome.detail)

    def test_failed_parallel_turn_blocks_a_sibling_that_has_not_launched_yet(self):
        ready, stopped = threading.Event(), threading.Event()
        terminate_all = self.children.terminate_all

        def first_failure():
            self.assertTrue(ready.wait(timeout=5))
            return AgentError("claude exited 1")

        def late_sibling():
            ready.set()
            self.assertTrue(stopped.wait(timeout=5))
            run_cli(["unused-cli"], self.run_dir, None, 5)
            return reply("should not finish")

        def terminate_then_release(grace=0.1):
            terminate_all(grace=grace)
            stopped.set()

        with mock.patch.object(self.children, "terminate_all", side_effect=terminate_then_release):
            with mock.patch.object(xreview.subprocess, "Popen", side_effect=AssertionError("late launch")) as launch:
                outcome, _, _ = self.orchestrate([first_failure], [late_sibling])
        self.assertEqual("error", outcome.result)
        self.assertIn("claude exited 1", outcome.detail)
        launch.assert_not_called()

    def test_unexpected_exception_still_produces_an_outcome(self):
        outcome, _, _ = self.orchestrate([reply("A-REVIEW")], [RuntimeError("bug")])
        self.assertEqual("error", outcome.result)
        self.assertIn("unexpected RuntimeError: bug", outcome.detail)

    def test_cancellation_produces_a_cancelled_outcome(self):
        outcome, _, _ = self.orchestrate([reply("A-REVIEW")], [Cancelled()])
        self.assertEqual("cancelled", outcome.result)

    def test_report_flags_an_approval_of_an_earlier_plan(self):
        outcome, orch, log = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("P1"), reply("P2")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("no", blocking=["U1"], non_blocking=["U2"]),
             AgentError("pi exited 1")],
        )
        self.assertEqual("error", outcome.result)
        final = render_details(outcome, orch, log, "t")
        self.assertIn("P2", final)
        self.assertIn("reviewed an earlier version of the plan", final)
        self.assertNotIn("Suggested amendments", final)
        self.assertIn("superseded (Pi, turn 6: U2)", final)

    def test_pi_can_draft(self):
        outcome, orch, _ = self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("ok", status="agree")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("B-PLAN")],
            drafter="B",
        )
        self.assertEqual("converged", outcome.result)
        self.assertEqual("B", orch.plan.label)
        self.assertIn("B-PLAN", self.a.prompts[2])

    def test_turn_files_are_written(self):
        self.orchestrate(
            [reply("A-REVIEW"), reply("A-CROSS"), reply("PLAN")],
            [reply("B-REVIEW"), reply("B-CROSS"), reply("ok", status="agree")],
        )
        names = {p.name for p in (self.run_dir / "turns").iterdir()}
        self.assertIn("01-A-independent.prompt.md", names)
        self.assertIn("02-B-independent.reply.md", names)
        self.assertIn("06-B-approve.reply.md", names)


PLAN_TEXT = "### U1 · Moderate · Fix the rule\n### U2 · Minor · Rename\n### U3 · Minor (optional) · Tidy"


class VerifierTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.children = xreview.ChildProcesses()
        patcher = mock.patch.object(xreview, "CHILDREN", self.children)
        patcher.start()
        self.addCleanup(patcher.stop)

    def verify(self, a_replies, b_replies, cross=False, result="converged"):
        self.a = FakeAgent("claude", a_replies)
        self.b = FakeAgent("pi", b_replies)
        log = RunLog(Path(self.tmp.name) / "verify-1")
        plan = PlanRef(Path("/runs/r1"), result, "A", 5, PLAN_TEXT)
        verifier = Verifier({"A": self.a, "B": self.b}, plan, "CHANGES: git diff HEAD", "`git diff HEAD`",
                            cross, log, echo=lambda _: None)
        outcome = verifier.run()
        return outcome, verifier, log

    def test_both_reviewers_check_the_plan_and_report_verdicts_per_item(self):
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", status="agree", non_blocking=["U3"],
                   verdicts=[("U1", "implemented"), ("U2", "implemented"), ("U3", "missing")])],
            [reply("B-CHECK", status="agree", verdicts=[("U1", "implemented"), ("U2", "implemented")])],
        )
        self.assertEqual("verified", outcome.result)
        self.assertIn("Number them `XA1`, `XA2`, ...; Reviewer B numbers its own `XB1`", self.a.prompts[0])
        self.assertIn("Number them `XB1`, `XB2`, ...; Reviewer A numbers its own `XA1`", self.b.prompts[0])
        prompt = self.a.prompts[0]
        self.assertIn("CHANGES: git diff HEAD", prompt)
        self.assertIn(PLAN_TEXT, prompt)
        self.assertIn('"verdicts"', prompt)
        self.assertEqual(["verify", "verify"], [entry["phase"] for entry in log.turns])
        report = render_verify(outcome, verifier, log)
        self.assertIn("**Verified.**", report)
        self.assertIn("- Review run: `/runs/r1` (converged); plan by Claude, turn 5", report)
        self.assertIn("| U1 | implemented | implemented |", report)
        self.assertIn("| U3 | missing | — |", report)
        self.assertIn("- **U3** (Claude, turn 1, verify): note U3", report)
        self.assertIn("## Pi: verification (turn 2)", report)
        self.assertNotIn("Warning", report)

    def test_blocking_deviations_and_unplanned_changes_are_reported(self):
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", blocking=["XA1"], verdicts=[("U1", "implemented"), ("U2", "implemented")])],
            [reply("B-CHECK", blocking=["U2"], verdicts=[("U1", "implemented"), ("U2", "deviates")])],
        )
        self.assertEqual("deviations", outcome.result)
        report = render_verify(outcome, verifier, log)
        self.assertIn("**Deviations found.**", report)
        self.assertIn("| U2 | implemented | deviates |", report)
        issues = report[report.index("## Blocking issues"):]
        self.assertIn("- **XA1**\n  - Claude: hold XA1 (x)", issues)
        self.assertIn("- **U2**\n  - Pi: hold U2 (x)", issues)

    def test_bare_unplanned_ids_get_the_reviewers_letter(self):
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", blocking=["X1"], verdicts=[("U1", "implemented")])],
            [reply("B-CHECK", blocking=["X1"], non_blocking=["X2"], verdicts=[("U1", "implemented")])],
        )
        self.assertEqual([["XA1"], ["XB1"]], [entry["blocking"] for entry in log.turns])
        report = render_verify(outcome, verifier, log)
        issues = report[report.index("## Blocking issues"):]
        self.assertIn("- **XA1**\n  - Claude: hold X1 (x)", issues)
        self.assertIn("- **XB1**\n  - Pi: hold X1 (x)", issues)
        self.assertIn("- **XB2** (Pi, turn 2, verify): note X2", report)

    def test_cross_confirmation_of_a_peer_finding_shares_its_id(self):
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", status="agree", verdicts=[("U1", "implemented")]),
             reply("A-ANSWER", blocking=["XB1"])],
            [reply("B-CHECK", blocking=["XB1"], verdicts=[("U1", "implemented")]),
             reply("B-ANSWER", blocking=["XB1"])],
            cross=True,
        )
        self.assertIn("refer to its unplanned changes and regressions by its ids (`XB1`, ...)", self.a.prompts[1])
        self.assertIn("by its ids (`XA1`, ...)", self.b.prompts[1])
        issues = render_verify(outcome, verifier, log)
        issues = issues[issues.index("## Blocking issues"):]
        self.assertIn("- **XB1**\n  - Claude: hold XB1 (x)\n  - Pi: hold XB1 (x)", issues)

    def test_a_verification_without_verdicts_is_asked_for_them(self):
        outcome, _, log = self.verify(
            [reply("A-CHECK", status="agree"), block(status="agree", verdicts=[("U1", "implemented")])],
            [reply("B-CHECK", status="agree", verdicts=[("U1", "implemented")])],
        )
        self.assertEqual("verified", outcome.result)
        self.assertIn("needs `verdicts`", self.a.prompts[1])
        self.assertEqual(["verify", "verify", "verify-status-retry"], [entry["phase"] for entry in log.turns])

    def test_cross_step_lets_each_reviewer_answer_the_other(self):
        moved = {"item": "U2", "from": "implemented", "to": "deviates", "reason": "B is right"}
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", status="agree", verdicts=[("U1", "implemented"), ("U2", "implemented")]),
             reply("A-ANSWER", blocking=["U2"], changed=[moved],
                   verdicts=[("U1", "implemented"), ("U2", "deviates")])],
            [reply("B-CHECK", blocking=["U2"], verdicts=[("U1", "implemented"), ("U2", "deviates")]),
             reply("B-ANSWER", blocking=["U2"])],
            cross=True,
        )
        self.assertEqual("deviations", outcome.result)
        self.assertIn("B-CHECK", self.a.prompts[1])
        self.assertIn("```peer-status", self.a.prompts[1])
        self.assertIn("A-CHECK", self.b.prompts[1])
        self.assertEqual(["verify", "verify", "verify-cross", "verify-cross"], [e["phase"] for e in log.turns])
        report = render_verify(outcome, verifier, log)
        # A's answer changed its verdict; B's answer had none, so its first verdicts stand.
        self.assertIn("| U2 | deviates | deviates |", report)
        self.assertIn("## Claude: answer to the other verification (turn 3)", report)
        self.assertIn("implemented → deviates", report)

    def test_a_question_stops_before_the_cross_step(self):
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", status="agree", verdicts=[("U1", "implemented")])],
            [reply("B?", status="needs_human", question="Which branch has the changes?")],
            cross=True,
        )
        self.assertEqual("needs_human", outcome.result)
        self.assertEqual(2, len(log.turns))
        self.assertIn("Which branch has the changes?", render_verify(outcome, verifier, log))

    def test_report_warns_when_the_review_did_not_converge(self):
        outcome, verifier, log = self.verify(
            [reply("A-CHECK", status="agree", verdicts=[("U1", "implemented")])],
            [reply("B-CHECK", status="agree", verdicts=[("U1", "implemented")])],
            result="round_cap",
        )
        self.assertIn("> **Warning:** the review ended as round_cap", render_verify(outcome, verifier, log))


def git_repo(path):
    """A Git repository with one committed file, without the user's hooks or signing."""
    path.mkdir()
    def git(*args):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
                        "-c", "core.hooksPath=/dev/null", *args], cwd=path, check=True, capture_output=True)
    git("init", "-q")
    (path / "a.txt").write_text("one\n")
    git("add", "a.txt")
    git("commit", "-q", "-m", "init")
    return git


def write_run(run_dir, cwd, turns, reviewers=None, plans=None):
    (run_dir / "turns").mkdir(parents=True)
    record = {"outcome": {"result": "converged"}, "cwd": str(cwd), "turns": turns}
    if reviewers is not None:
        record["reviewers"] = reviewers
    (run_dir / "run.json").write_text(json.dumps(record))
    for (seq, label, phase), text in (plans or {}).items():
        (run_dir / "turns" / f"{seq:02d}-{label}-{phase}.reply.md").write_text(text)


RECORDED = {
    "A": {"kind": "claude", "session_id": "claude-session-1",
          "settings": {"model": "opus", "effort": "high", "extra_args": ["--verbose"]}},
    "B": {"kind": "pi", "session_id": "pi-session-1",
          "settings": {"model": "pi-model", "thinking": "low", "tools": "read,grep", "extra_args": []}},
}


class VerifyCliTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.run_dir = self.dir / "run"

    def args(self, *extra):
        return xreview.build_parser().parse_args(["verify", str(self.run_dir), *extra])

    def test_latest_plan_is_the_last_plan_turn_that_finished(self):
        turns = [{"seq": 5, "label": "A", "phase": "draft", "status": "open"},
                 {"seq": 7, "label": "A", "phase": "revise", "status": "open"},
                 {"seq": 9, "label": "A", "phase": "revise", "error": "claude exited 1"}]
        write_run(self.run_dir, self.dir, turns, plans={
            (5, "A", "draft"): reply("P1"), (7, "A", "revise"): reply("P2")})
        plan = xreview.latest_plan(self.run_dir, xreview.load_run(self.run_dir))
        self.assertEqual((7, "A", "P2", "converged"), (plan.seq, plan.label, plan.text, plan.result))

    def test_final_report_wins_over_the_plan_it_restates(self):
        turns = [{"seq": 5, "label": "A", "phase": "draft", "status": "open"},
                 {"seq": 7, "label": "A", "phase": "report", "status": "agree"}]
        write_run(self.run_dir, self.dir, turns, plans={
            (5, "A", "draft"): reply("P1"), (7, "A", "report"): reply("## Findings\n### U1 · Major · x")})
        plan = xreview.latest_plan(self.run_dir, xreview.load_run(self.run_dir))
        self.assertEqual((7, "## Findings\n### U1 · Major · x"), (plan.seq, plan.text))

    def test_run_without_a_plan_or_record_is_refused(self):
        with self.assertRaises(SystemExit):
            xreview.load_run(self.run_dir)
        write_run(self.run_dir, self.dir, [{"seq": 1, "label": "A", "phase": "independent", "status": "open"}])
        with self.assertRaisesRegex(SystemExit, "no unified plan"):
            xreview.latest_plan(self.run_dir, xreview.load_run(self.run_dir))

    def test_resumed_agents_keep_the_runs_sessions_and_settings(self):
        turns = [{"seq": 1, "label": "A", "cost_usd": 0.8, "session_cost_usd": 0.8},
                 {"seq": 3, "label": "A", "cost_usd": 0.3, "session_cost_usd": 1.1}]
        write_run(self.run_dir, self.dir, turns, reviewers=RECORDED)
        run = xreview.load_run(self.run_dir)
        agents = xreview.resumed_agents(run, self.run_dir, self.dir, self.args())
        claude, pi = agents["A"].command(), agents["B"].command("p")
        self.assertEqual("claude-session-1", claude[claude.index("--resume") + 1])
        self.assertEqual(["opus", "high"], [claude[claude.index(flag) + 1] for flag in ("--model", "--effort")])
        self.assertIn("--verbose", claude)
        self.assertEqual(1.1, agents["A"].session_cost)
        self.assertEqual("pi-session-1", pi[pi.index("--session-id") + 1])
        self.assertNotIn("--name", pi)
        self.assertEqual(["low", "read,grep"], [pi[pi.index(flag) + 1] for flag in ("--thinking", "--tools")])
        self.assertEqual(3600, agents["A"].timeout)

        overridden = xreview.resumed_agents(run, self.run_dir, self.dir,
                                            self.args("--claude-model", "sonnet", "--pi-arg=--no-skills"))
        self.assertEqual("sonnet", overridden["A"].model)
        self.assertEqual(("--no-skills",), overridden["B"].extra_args)

    def test_older_runs_resume_from_their_turn_records(self):
        """Before settings were recorded, run.json held the session ids only in the
        turns, and cost_usd was the session total."""
        turns = [{"seq": 1, "label": "A", "session_id": "c-1", "cost_usd": 0.8},
                 {"seq": 2, "label": "B", "session_id": "p-1"},
                 {"seq": 3, "label": "A", "session_id": "c-1", "cost_usd": 1.11}]
        write_run(self.run_dir, self.dir, turns, reviewers={"A": {"kind": "claude"}, "B": {"kind": "pi"}})
        agents = xreview.resumed_agents(xreview.load_run(self.run_dir), self.run_dir, self.dir, self.args())
        self.assertEqual(("c-1", "p-1"), (agents["A"].session_id, agents["B"].session_id))
        self.assertEqual(1.11, agents["A"].session_cost)
        self.assertEqual((None, xreview.DEFAULT_PI_TOOLS), (agents["A"].model, agents["B"].tools))

    def test_session_cost_and_numbering_continue_after_earlier_verify_runs(self):
        write_run(self.run_dir, self.dir, [{"seq": 1, "label": "A", "session_cost_usd": 1.0}], reviewers=RECORDED)
        for number, total in ((1, 2.5), (3, 3.0)):
            (self.run_dir / f"verify-{number}").mkdir()
            (self.run_dir / f"verify-{number}" / "verify.json").write_text(
                json.dumps({"turns": [{"seq": 1, "label": "A", "session_cost_usd": total}]}))
        agents = xreview.resumed_agents(xreview.load_run(self.run_dir), self.run_dir, self.dir, self.args())
        self.assertEqual(3.0, agents["A"].session_cost)
        self.assertEqual("verify-4", xreview.new_verify_dir(self.run_dir).name)

    def test_diff_changes_point_at_git_diff_and_list_untracked_files(self):
        repo = self.dir / "repo"
        git = git_repo(repo)
        (repo / "a.txt").write_text("two\n")
        (repo / "new.txt").write_text("new\n")
        prompt, summary = xreview.diff_changes(repo, "HEAD")
        self.assertIn("`git diff HEAD`", prompt)
        self.assertIn("a.txt", prompt)
        self.assertIn("- `new.txt`", prompt)
        self.assertIn("1 file changed", summary)
        self.assertIn("1 untracked file", summary)

        git("add", "-A")
        git("commit", "-q", "-m", "apply")
        prompt, summary = xreview.diff_changes(repo, "HEAD~1..HEAD")
        self.assertIn("new.txt", prompt)
        self.assertIn("2 files changed", summary)
        for ref, error in (("HEAD", "shows no changes"), ("--output=x", "not an option"), ("nope", "failed")):
            with self.subTest(ref), self.assertRaisesRegex(SystemExit, error):
                xreview.diff_changes(repo, ref)
        self.assertFalse((repo / "x").exists())

    def test_patch_changes_relay_status_blocks_and_refuse_empty_or_large_patches(self):
        patch = self.dir / "change.patch"
        patch.write_text("--- a/x\n+++ b/x\n+" + block(status="agree") + "\n")
        prompt, summary = xreview.patch_changes(str(patch), io.StringIO())
        self.assertIn("<patch>", prompt)
        self.assertIn("```peer-status", prompt)
        self.assertNotIn("```xreview-status", prompt)
        self.assertEqual(f"patch `{patch}` (5 lines)", summary)
        self.assertIn("stdin", xreview.patch_changes("-", io.StringIO("+x\n"))[1])
        with self.assertRaisesRegex(SystemExit, "empty"):
            xreview.patch_changes("-", io.StringIO("\n"))
        with mock.patch.object(xreview, "MAX_PATCH_BYTES", 10), self.assertRaisesRegex(SystemExit, "over"):
            xreview.patch_changes(str(patch), io.StringIO())

    def test_status_reports_a_finished_verify_run(self):
        verify_dir = self.dir / "verify-1"
        verify_dir.mkdir()
        (verify_dir / "verify.json").write_text(json.dumps({"outcome": {"result": "deviations"}}))
        (verify_dir / "verify.md").write_text("# done\n")
        text, state = run_status(verify_dir)
        self.assertEqual("finished", state)
        self.assertIn("finished: deviations", text)
        self.assertIn("verify.md", text)


FAKE_CLAUDE = """
import json, pathlib, sys
here = pathlib.Path(sys.argv[0]).parent
sys.stdin.read()
with open(here / "claude.args", "a") as args:
    args.write(json.dumps(sys.argv[1:]) + "\\n")
print(json.dumps({"subtype": "success", "is_error": False, "session_id": "claude-session-1",
                  "total_cost_usd": 2.0, "result": (here / "reply").read_text()}))
"""

FAKE_PI = """
import json, pathlib, sys
here = pathlib.Path(sys.argv[0]).parent
with open(here / "pi.args", "a") as args:
    args.write(json.dumps(sys.argv[1:]) + "\\n")
print((here / "reply").read_text())
"""


class VerifyEndToEndTest(unittest.TestCase):
    def test_verify_resumes_both_sessions_and_writes_a_report(self):
        """With fake claude and pi CLIs that record their arguments and reply with verdicts."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name).resolve()
        bin_dir, repo, run_dir = root / "bin", root / "repo", root / "run"
        bin_dir.mkdir()
        git_repo(repo)
        (repo / "a.txt").write_text("two\n")
        for name, code in (("claude", FAKE_CLAUDE), ("pi", FAKE_PI)):
            (bin_dir / name).write_text(f"#!{sys.executable}\n{code}")
            (bin_dir / name).chmod(0o755)
        (bin_dir / "reply").write_text(reply("Checked.", status="agree", verdicts=[("U1", "implemented")]))
        turns = [{"seq": 5, "label": "A", "kind": "claude", "phase": "draft", "status": "open",
                  "session_id": "claude-session-1", "cost_usd": 0.5, "session_cost_usd": 1.5}]
        write_run(run_dir, repo, turns, reviewers=RECORDED, plans={(5, "A", "draft"): reply("### U1 · Fix a.txt")})

        env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}
        proc = subprocess.run([sys.executable, str(SCRIPT), "verify", str(run_dir), "--diff", "HEAD"],
                              env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(xreview.EXIT_CONVERGED, proc.returncode, proc.stderr)
        report_path = run_dir / "verify-1" / "verify.md"
        self.assertEqual(str(report_path), proc.stdout.strip())
        report = report_path.read_text()
        self.assertIn("**Verified.**", report)
        self.assertIn("| U1 | implemented | implemented |", report)
        self.assertIn("1 file changed", report)

        claude_args = json.loads((bin_dir / "claude.args").read_text())
        self.assertEqual("claude-session-1", claude_args[claude_args.index("--resume") + 1])
        self.assertEqual("opus", claude_args[claude_args.index("--model") + 1])
        pi_args = json.loads((bin_dir / "pi.args").read_text())
        self.assertEqual("pi-session-1", pi_args[pi_args.index("--session-id") + 1])
        self.assertNotIn("--name", pi_args)
        self.assertIn("### U1 · Fix a.txt", pi_args[-1])
        record = json.loads((run_dir / "verify-1" / "verify.json").read_text())
        self.assertEqual({"A": {"U1": "implemented"}, "B": {"U1": "implemented"}}, record["verdicts"])
        self.assertEqual(0.5, next(turn for turn in record["turns"] if turn["label"] == "A")["cost_usd"])


class BriefTest(unittest.TestCase):
    def test_dash_reads_the_brief_from_stdin(self):
        self.assertEqual("Review x.", load_brief("-", None, io.StringIO("Review x.\n")))

    def test_inline_text_is_used_as_is(self):
        self.assertEqual("Review y.", load_brief(None, "Review y.", io.StringIO()))

    def test_empty_brief_is_rejected(self):
        with self.assertRaises(SystemExit):
            load_brief("-", None, io.StringIO("  \n"))


class RunStatusTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.run_dir = Path(tmp.name)

    def test_finished_run_reports_outcome_and_final(self):
        (self.run_dir / "run.json").write_text(json.dumps({"outcome": {"result": "round_cap"}}))
        (self.run_dir / "final.md").write_text("# done\n")
        text, state = run_status(self.run_dir)
        self.assertEqual("finished", state)
        self.assertIn("finished: round_cap", text)
        self.assertIn(str(self.run_dir / "final.md"), text)

    def test_live_process_is_running_with_progress_tail(self):
        (self.run_dir / "pid").write_text(str(os.getpid()))
        (self.run_dir / "progress.log").write_text("".join(f"line {i}\n" for i in range(10)))
        text, state = run_status(self.run_dir)
        self.assertEqual("running", state)
        self.assertIn(f"running (pid {os.getpid()})", text)
        self.assertIn("line 9", text)
        self.assertNotIn("line 2", text)

    def test_dead_process_without_final_is_reported(self):
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait()
        (self.run_dir / "pid").write_text(str(child.pid))
        text, state = run_status(self.run_dir)
        self.assertEqual("stopped", state)
        self.assertIn("not running", text)

    def test_missing_run_directory(self):
        self.assertEqual("missing", run_status(self.run_dir / "nope")[1])


class CancelTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def test_cancel_signals_a_running_run(self):
        child = subprocess.Popen(["sleep", "60"])
        self.addCleanup(child.kill)
        (self.dir / "pid").write_text(str(child.pid))
        text, sent = cancel_run(self.dir, wait=0)
        self.assertTrue(sent)
        self.assertEqual(-signal.SIGTERM, child.wait(timeout=5))
        self.assertIn(str(child.pid), text)

    def test_finished_run_has_nothing_to_cancel(self):
        (self.dir / "run.json").write_text(json.dumps({"outcome": {"result": "converged"}}))
        (self.dir / "final.md").write_text("# done\n")
        text, sent = cancel_run(self.dir, wait=0)
        self.assertFalse(sent)
        self.assertIn("nothing to cancel", text)

    def test_sigterm_stops_the_reviewers_and_writes_a_cancelled_report(self):
        """End to end with fake claude and pi CLIs that only record their pid and sleep."""
        bin_dir, cwd, run_dir = self.dir / "bin", self.dir / "work", self.dir / "run"
        bin_dir.mkdir()
        cwd.mkdir()
        pids = self.dir / "pids"
        for name in ("claude", "pi"):
            fake = bin_dir / name
            fake.write_text(f'#!/bin/sh\necho $$ >> "{pids}"\nexec sleep 60\n')
            fake.chmod(0o755)
        env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}
        proc = subprocess.Popen(
            [sys.executable, str(SCRIPT), "review", "--brief-text", "Review x.", "--cwd", str(cwd),
             "--run-dir", str(run_dir)],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(proc.kill)
        self.assertTrue(wait_until(lambda: pids.exists() and len(pids.read_text().split()) == 2, 10))
        reviewer_pids = [int(pid) for pid in pids.read_text().split()]

        proc.send_signal(signal.SIGTERM)
        self.assertEqual(xreview.EXIT_ERROR, proc.wait(timeout=30))
        self.assertIn("Cancelled", (run_dir / "final.md").read_text())
        self.assertIn("## Turns", (run_dir / "details.md").read_text())
        run = json.loads((run_dir / "run.json").read_text())
        self.assertLessEqual(dt.datetime.fromisoformat(run["started"]), dt.datetime.fromisoformat(run["ended"]))
        for pid in reviewer_pids:
            self.assertTrue(wait_until(lambda: not pid_alive(pid)), f"reviewer {pid} still running")


class TimeFormatTest(unittest.TestCase):
    def test_duration_adds_hours_for_long_runs(self):
        self.assertEqual(["7s", "9m07s", "1h02m05s"], [duration(s) for s in (7, 547, 3725)])

    def test_run_times_show_the_end_date_when_it_differs(self):
        self.assertEqual("- Started 2026-10-18 23:50:00, ended 2026-10-19 00:10:00; wall time 20m00s",
                         run_times(dt.datetime(2026, 10, 18, 23, 50), dt.datetime(2026, 10, 19, 0, 10)))


class EchoTest(unittest.TestCase):
    def test_appends_timestamped_lines_to_progress_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            echo = make_echo(Path(tmp), to_stderr=False)
            echo("first")
            echo("second")
            lines = (Path(tmp) / "progress.log").read_text().splitlines()
        self.assertEqual(2, len(lines))
        self.assertTrue(lines[0].endswith("] first"))


if __name__ == "__main__":
    unittest.main()
