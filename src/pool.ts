import { BigInt } from "@graphprotocol/graph-ts"
import {
  Pool,
  Deposit,
  Withdraw
} from "../generated/Pool/Pool"
import { Pool } from "../generated/schema"

export function handleDeposit(event: Deposit): void {}

export function handleWithdraw(event: Withdraw): void {}
