import {FailedEntity, NFTEntity, RemarkEntity} from "../types";
import {SubstrateExtrinsic} from "@subql/types";
import {getRemarksFrom, RemarkResult} from './utils';
import {eventFrom, RmrkEvent, RmrkInteraction} from './utils/types';
import NFTUtils, {hexToString} from './utils/NftUtils';
import {
    canOrElseError,
    exists,
    isBurned,
    isBuyLegalOrElseError,
    isPositiveOrElseError,
    isTransferable
} from './utils/consolidator'
import {randomBytes} from 'crypto'
import {ensureInteraction} from './utils/helper';

async function buy(remark: RemarkResult) {
    let interaction = null

    try {
        interaction = ensureInteraction(NFTUtils.unwrap(remark.value) as RmrkInteraction)
        const nft = await NFTEntity.get(interaction.id)
        canOrElseError<NFTEntity>(exists, nft, true)
        canOrElseError<NFTEntity>(isBurned, nft)
        canOrElseError<NFTEntity>(isTransferable, nft, true)
        isPositiveOrElseError(nft.price, true)
        isBuyLegalOrElseError(nft, remark.extra || [])
        nft.currentOwner = remark.caller
        nft.price = BigInt(0)
        nft.events.push(eventFrom(RmrkEvent.BUY, remark, remark.caller))
        nft.updatedAt = remark.timestamp
        await nft.save();

    } catch (e) {
        logger.warn(`[BUY] ${e.message} ${JSON.stringify(interaction)}`)
        await logFail(JSON.stringify(interaction), e.message, RmrkEvent.BUY)
    }
}


async function logFail(message: string, reason: string, interaction: RmrkEvent) {
    try {
        const fail = {
            id: randomBytes(20).toString('hex'),
            value: message,
            reason,
            interaction
        }

        const entity = FailedEntity.create(fail)
        await entity.save()

    } catch (e) {
        logger.warn(`[FAIL IN FAIL] ${interaction}::${message}`)
    }
}

export async function handleRemark(extrinsic: SubstrateExtrinsic): Promise<void> {
    const records = getRemarksFrom(extrinsic)

    for (const remark of records) {
        try {
            const decoded = hexToString(remark.value)
            const event: RmrkEvent = NFTUtils.getAction(decoded)

            switch (event) {
                case RmrkEvent.BUY:
                    await buy(remark)
                    break;
                default:
                    logger.warn(`[SKIP] ${event}::${remark.value}::${remark.blockNumber}`)
                // throw new EvalError(`Unable to evaluate following string, ${event}::${remark.value}`)
            }
        } catch (e) {
            logger.error(`[MALFORMED] ${remark.blockNumber}::${hexToString(remark.value)}`)
        }

    }
}
