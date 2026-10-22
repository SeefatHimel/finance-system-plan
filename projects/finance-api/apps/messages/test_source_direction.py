from django.test import SimpleTestCase

from .source_direction import source_direction_for_kind


class SourceDirectionTests(SimpleTestCase):
    def test_known_message_kinds_have_reporting_side_direction(self):
        self.assertEqual(source_direction_for_kind("send_money"), "debit")
        self.assertEqual(source_direction_for_kind("receive_money"), "credit")
        self.assertEqual(source_direction_for_kind("refund"), "credit")

    def test_unknown_and_nonfinancial_messages_have_no_invented_direction(self):
        self.assertEqual(source_direction_for_kind("unknown"), "")
        self.assertEqual(source_direction_for_kind("balance_notice"), "")
        self.assertEqual(source_direction_for_kind("card_payment"), "")
        self.assertEqual(source_direction_for_kind("reversal"), "")
