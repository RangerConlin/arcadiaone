import test from "node:test";import assert from "node:assert/strict";import {calculateInvoice,effectiveInvoiceStatus} from "./calculations";
test("calculates decimal quantity, fixed discount and tax exactly",()=>{assert.deepEqual(calculateInvoice([{quantity:"2.5",unitPrice:"19.99",discountAmount:"5.00",taxRate:"8.25"}]),{lines:[{subtotal:"49.98",discount:"5.00",tax:"3.71",total:"48.69"}],subtotal:"49.98",discountTotal:"5.00",taxTotal:"3.71",total:"48.69"})});
test("rejects excessive discounts",()=>assert.throws(()=>calculateInvoice([{quantity:1,unitPrice:2,discountAmount:3}])));
test("derives overdue without mutating stored status",()=>assert.equal(effectiveInvoiceStatus("SENT",new Date("2020-01-01"),"1.00",new Date("2020-01-02")),"OVERDUE"));
