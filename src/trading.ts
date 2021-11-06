import { BigInt, store, log, ethereum } from "@graphprotocol/graph-ts"
import {
  Trading,
  AddMargin,
  ClosePosition,
  NewPosition
} from "../generated/Trading/Trading"
import { Data, DayData, Product, Position, Trade } from "../generated/schema"

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export const ZERO_BI = BigInt.fromI32(0)
export const ONE_BI = BigInt.fromI32(1)
export const UNIT_BI = BigInt.fromString("1000000000000000000")

export const BASE_FEE = BigInt.fromI32(25) // 0.25%
export const LIQUIDATION_THRESHOLD = BigInt.fromI32(8000) // 80%
export const BPS_SCALER = BigInt.fromI32(10000)

function getData(): Data {
  let data = Data.load((1).toString())
  if (data == null) {
    data = new Data((1).toString())
        
    data.cumulativeFees = ZERO_BI
    data.cumulativePnl = ZERO_BI
    data.cumulativeVolume = ZERO_BI
    data.cumulativeMargin = ZERO_BI

    data.positionCount = ZERO_BI
    data.tradeCount = ZERO_BI
  }
  return data!
}

function getDayData(event: ethereum.Event): DayData {

  let timestamp = event.block.timestamp.toI32()
  let day_id = timestamp / 86400
  let dayData = DayData.load(day_id.toString())

  if (dayData == null) {
    dayData = new DayData(day_id.toString())
    dayData.date = BigInt.fromI32(day_id * 86400)
    dayData.cumulativeVolume = ZERO_BI
    dayData.cumulativeMargin = ZERO_BI
    dayData.positionCount = ZERO_BI
    dayData.tradeCount = ZERO_BI
    dayData.save()
  }

  return dayData!

}

export function handleNewPosition(event: NewPosition): void {

  // Create position
  let position = new Position(event.params.positionId.toString())

  position.productId = event.params.productId
  position.price = event.params.price
  position.margin = event.params.margin

  position.size = event.params.size

  let leverage = event.params.size.times(UNIT_BI).div(event.params.margin)

  position.leverage = leverage

  position.user = event.params.user
  position.currency = event.params.currency

  position.fee = event.params.fee
  position.isLong = event.params.isLong

  position.createdAtTimestamp = event.block.timestamp
  position.createdAtBlockNumber = event.block.number

  let product = Product.load((event.params.productId).toString())

  if (product == null) {

    product = new Product(event.params.productId.toString())

    product.cumulativePnl = ZERO_BI
    product.cumulativeVolume = ZERO_BI
    product.cumulativeMargin = ZERO_BI

    product.positionCount = ZERO_BI
    product.tradeCount = ZERO_BI

  }

  let liquidationPrice = ZERO_BI
  if (position.isLong) {
    liquidationPrice = position.price.minus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(leverage))
  } else {
    liquidationPrice = position.price.plus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(leverage))
  }

  position.liquidationPrice = liquidationPrice

  // volume updates
  let data = getData()
  data.cumulativeFees = data.cumulativeFees.plus(event.params.fee)
  data.cumulativeVolume = data.cumulativeVolume.plus(event.params.size)
  data.cumulativeMargin = data.cumulativeMargin.plus(event.params.margin)
  data.positionCount = data.positionCount.plus(ONE_BI)

  let dayData = getDayData(event)
  dayData.cumulativeFees = dayData.cumulativeFees.plus(event.params.fee)
  dayData.cumulativeVolume = dayData.cumulativeVolume.plus(event.params.size)
  dayData.cumulativeMargin = dayData.cumulativeMargin.plus(event.params.margin)
  dayData.positionCount = dayData.positionCount.plus(ONE_BI)

  product.cumulativeFees = product.cumulativeFees.plus(event.params.fee)
  product.cumulativeVolume = product.cumulativeVolume.plus(event.params.size)
  product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)
  product.positionCount = product.positionCount.plus(ONE_BI)

  position.save()
  data.save()
  dayData.save()
  product.save()

}

export function handleAddMargin(event: AddMargin): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    position.margin = event.params.newMargin
    position.leverage = event.params.newLeverage

    position.updatedAtTimestamp = event.block.timestamp
    position.updatedAtBlockNumber = event.block.number

    // volume updates

    let data = getData()
    data.cumulativeMargin = data.cumulativeMargin.plus(event.params.margin)

    let dayData = getDayData(event)
    dayData.cumulativeMargin = dayData.cumulativeMargin.plus(event.params.margin)

    let product = Product.load((position.productId).toString())
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)

    let liquidationPrice = ZERO_BI
    if (position.isLong) {
      liquidationPrice = position.price.minus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(position.leverage))
    } else {
      liquidationPrice = position.price.plus((position.price.times(LIQUIDATION_THRESHOLD).times(BigInt.fromI32(10000))).div(position.leverage))
    }

    position.liquidationPrice = liquidationPrice

    position.save()
    data.save()
    dayData.save()
    product.save()

  }

}

export function handleClosePosition(event: ClosePosition): void {

  let position = Position.load(event.params.positionId.toString())

  if (position) {

    let data = getData()
    let dayData = getDayData(event)
    let product = Product.load((event.params.productId).toString())

    data.tradeCount = data.tradeCount.plus(ONE_BI)

    // create new trade
    let trade = new Trade(data.tradeCount.toString())
    trade.txHash = event.transaction.hash.toHexString()
    
    trade.positionId = event.params.positionId
    trade.productId = event.params.productId
    trade.leverage = position.leverage

    trade.size = event.params.size
    
    trade.entryPrice = position.price
    trade.closePrice = event.params.price

    trade.margin = event.params.margin
    trade.user = event.params.user
    trade.currency = position.currency

    trade.fee = event.params.fee
    trade.pnl = event.params.pnl
    trade.wasLiquidated = event.params.wasLiquidated

    let isFullClose = event.params.margin == position.margin
    
    trade.isFullClose = isFullClose

    trade.isLong = position.isLong

    trade.duration = event.block.timestamp.minus(position.createdAtTimestamp)

    trade.timestamp = event.block.timestamp
    trade.blockNumber = event.block.number

    // Update position

    if (isFullClose) {
      store.remove('Position', event.params.positionId.toString())
      data.positionCount = data.positionCount.minus(ONE_BI)
      product.positionCount = product.positionCount.minus(ONE_BI)
    } else {
      // Update position with partial close, e.g. subtract margin
      position.margin = position.margin.minus(event.params.margin)
      position.size = position.size.minus(event.params.size)
      position.save()
    }

    // update volumes

    data.cumulativeFees = data.cumulativeFees.plus(event.params.fee)
    data.cumulativeVolume = data.cumulativeVolume.plus(event.params.size)
    data.cumulativeMargin = data.cumulativeMargin.plus(event.params.margin)

    data.cumulativePnl = data.cumulativePnl.plus(event.params.pnl)
    dayData.cumulativePnl = dayData.cumulativePnl.plus(event.params.pnl)
    product.cumulativePnl = product.cumulativePnl.plus(event.params.pnl)

    dayData.cumulativeFees = dayData.cumulativeFees.plus(event.params.fee)
    dayData.cumulativeVolume = dayData.cumulativeVolume.plus(event.params.size)
    dayData.cumulativeMargin = dayData.cumulativeMargin.plus(event.params.margin)
    dayData.tradeCount = dayData.tradeCount.plus(ONE_BI)

    product.cumulativeFees = product.cumulativeFees.plus(event.params.fee)
    product.cumulativeVolume = product.cumulativeVolume.plus(event.params.size)
    product.cumulativeMargin = product.cumulativeMargin.plus(event.params.margin)
    product.tradeCount = product.tradeCount.plus(ONE_BI)

    trade.save()
    data.save()
    dayData.save()
    product.save()

  }

}