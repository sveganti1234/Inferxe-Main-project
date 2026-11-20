import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import {
  CircleDollarSign,
  TrendingUp,
  Activity,
  Zap,
  MapPin,
  CheckCircle2,
  Calendar,
  ArrowUpRight,
  Database,
  AlertCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { clampTooltipHorizontal, downsampleLTTB } from '../../lib/chartUtils'

export type PriceHistoryRange = '7d' | '30d' | '90d' | '1y'
export type GpuModel = 'L4' | 'L40S' | 'A100' | 'H100' | 'H200'
export type PriceDataSource = 'live' | 'demo'

export interface PricePoint {
  id: string
  label: string
  fullDate: string
  price: number
  status: 'Off-Peak Discount' | 'Peak Window' | 'Optimal' | 'Nominal'
  region: string
  savings: number
  nodes: number
}

export type PriceHistoryDataset = Partial<
  Record<GpuModel, Partial<Record<PriceHistoryRange, PricePoint[]>>>
>

// Illustrative DEMO DATA price history dataset for all 5 GPUs across 4 ranges
const PRICE_DATA: Record<GpuModel, Record<PriceHistoryRange, PricePoint[]>> = {
  L4: {
    '7d': [
      { id: 'l4-7-1', label: 'Mon', fullDate: 'Monday, 10 Oct', price: 62, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 48, nodes: 24 },
      { id: 'l4-7-2', label: 'Tue', fullDate: 'Tuesday, 11 Oct', price: 65, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 45, nodes: 18 },
      { id: 'l4-7-3', label: 'Wed', fullDate: 'Wednesday, 12 Oct', price: 66, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 44, nodes: 15 },
      { id: 'l4-7-4', label: 'Thu', fullDate: 'Thursday, 13 Oct', price: 64, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 46, nodes: 22 },
      { id: 'l4-7-5', label: 'Fri', fullDate: 'Friday, 14 Oct', price: 60, status: 'Optimal', region: 'Noida Tier-IV', savings: 50, nodes: 28 },
      { id: 'l4-7-6', label: 'Sat', fullDate: 'Saturday, 15 Oct', price: 54, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 55, nodes: 36 },
      { id: 'l4-7-7', label: 'Today', fullDate: 'Sunday, 16 Oct (Today)', price: 52, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 57, nodes: 42 },
    ],
    '30d': [
      { id: 'l4-30-1', label: 'Day 1', fullDate: '17 Sep', price: 56, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 53, nodes: 30 },
      { id: 'l4-30-2', label: 'Day 4', fullDate: '20 Sep', price: 62, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 48, nodes: 22 },
      { id: 'l4-30-3', label: 'Day 7', fullDate: '23 Sep', price: 59, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 51, nodes: 26 },
      { id: 'l4-30-4', label: 'Day 10', fullDate: '26 Sep', price: 65, status: 'Peak Window', region: 'Noida Tier-IV', savings: 45, nodes: 17 },
      { id: 'l4-30-5', label: 'Day 13', fullDate: '29 Sep', price: 61, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 49, nodes: 25 },
      { id: 'l4-30-6', label: 'Day 16', fullDate: '02 Oct', price: 54, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 55, nodes: 34 },
      { id: 'l4-30-7', label: 'Day 19', fullDate: '05 Oct', price: 63, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 47, nodes: 21 },
      { id: 'l4-30-8', label: 'Day 22', fullDate: '08 Oct', price: 66, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 44, nodes: 16 },
      { id: 'l4-30-9', label: 'Day 25', fullDate: '11 Oct', price: 58, status: 'Optimal', region: 'Noida Tier-IV', savings: 52, nodes: 29 },
      { id: 'l4-30-10', label: 'Today', fullDate: '16 Oct (Today)', price: 60, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 50, nodes: 28 },
    ],
    '90d': [
      { id: 'l4-90-1', label: 'W1', fullDate: 'Week 1 · Late July', price: 58, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 52, nodes: 28 },
      { id: 'l4-90-2', label: 'W2', fullDate: 'Week 2 · Early Aug', price: 64, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 46, nodes: 20 },
      { id: 'l4-90-3', label: 'W3', fullDate: 'Week 3 · Mid Aug', price: 61, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 49, nodes: 24 },
      { id: 'l4-90-4', label: 'W4', fullDate: 'Week 4 · Late Aug', price: 56, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 54, nodes: 32 },
      { id: 'l4-90-5', label: 'W5', fullDate: 'Week 5 · Early Sep', price: 63, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 47, nodes: 22 },
      { id: 'l4-90-6', label: 'W6', fullDate: 'Week 6 · Mid Sep', price: 67, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 43, nodes: 14 },
      { id: 'l4-90-7', label: 'W7', fullDate: 'Week 7 · Late Sep', price: 62, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 48, nodes: 23 },
      { id: 'l4-90-8', label: 'W8', fullDate: 'Week 8 · End Sep', price: 55, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 55, nodes: 35 },
      { id: 'l4-90-9', label: 'W9', fullDate: 'Week 9 · Early Oct', price: 60, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 50, nodes: 27 },
      { id: 'l4-90-10', label: 'W10', fullDate: 'Week 10 · Mid Oct', price: 65, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 45, nodes: 18 },
      { id: 'l4-90-11', label: 'W11', fullDate: 'Week 11 · Past Week', price: 68, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 42, nodes: 12 },
      { id: 'l4-90-12', label: 'Now', fullDate: 'Current Week (Now)', price: 60, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 50, nodes: 30 },
    ],
    '1y': [
      { id: 'l4-1y-1', label: 'Nov', fullDate: 'Nov 2025', price: 66, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 44, nodes: 16 },
      { id: 'l4-1y-2', label: 'Dec', fullDate: 'Dec 2025', price: 63, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 47, nodes: 21 },
      { id: 'l4-1y-3', label: 'Jan', fullDate: 'Jan 2026', price: 58, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 52, nodes: 29 },
      { id: 'l4-1y-4', label: 'Feb', fullDate: 'Feb 2026', price: 56, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 54, nodes: 33 },
      { id: 'l4-1y-5', label: 'Mar', fullDate: 'Mar 2026', price: 59, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 51, nodes: 27 },
      { id: 'l4-1y-6', label: 'Apr', fullDate: 'Apr 2026', price: 62, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 48, nodes: 23 },
      { id: 'l4-1y-7', label: 'May', fullDate: 'May 2026', price: 60, status: 'Optimal', region: 'Hyderabad ap-south-2', savings: 50, nodes: 26 },
      { id: 'l4-1y-8', label: 'Jun', fullDate: 'Jun 2026', price: 57, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 53, nodes: 31 },
      { id: 'l4-1y-9', label: 'Jul', fullDate: 'Jul 2026', price: 59, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 51, nodes: 28 },
      { id: 'l4-1y-10', label: 'Aug', fullDate: 'Aug 2026', price: 61, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 49, nodes: 24 },
      { id: 'l4-1y-11', label: 'Sep', fullDate: 'Sep 2026', price: 63, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 47, nodes: 22 },
      { id: 'l4-1y-12', label: 'Oct', fullDate: 'Oct 2026', price: 60, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 50, nodes: 28 },
    ],
  },
  L40S: {
    '7d': [
      { id: 'l40-7-1', label: 'Mon', fullDate: 'Monday, 10 Oct', price: 102, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 42, nodes: 20 },
      { id: 'l40-7-2', label: 'Tue', fullDate: 'Tuesday, 11 Oct', price: 108, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 38, nodes: 14 },
      { id: 'l40-7-3', label: 'Wed', fullDate: 'Wednesday, 12 Oct', price: 112, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 36, nodes: 10 },
      { id: 'l40-7-4', label: 'Thu', fullDate: 'Thursday, 13 Oct', price: 105, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 40, nodes: 18 },
      { id: 'l40-7-5', label: 'Fri', fullDate: 'Friday, 14 Oct', price: 98, status: 'Optimal', region: 'Noida Tier-IV', savings: 44, nodes: 24 },
      { id: 'l40-7-6', label: 'Sat', fullDate: 'Saturday, 15 Oct', price: 88, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 50, nodes: 32 },
      { id: 'l40-7-7', label: 'Today', fullDate: 'Sunday, 16 Oct (Today)', price: 85, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 52, nodes: 38 },
    ],
    '30d': [
      { id: 'l40-30-1', label: 'Day 1', fullDate: '17 Sep', price: 92, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 48, nodes: 26 },
      { id: 'l40-30-2', label: 'Day 4', fullDate: '20 Sep', price: 105, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 40, nodes: 17 },
      { id: 'l40-30-3', label: 'Day 7', fullDate: '23 Sep', price: 96, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 45, nodes: 23 },
      { id: 'l40-30-4', label: 'Day 10', fullDate: '26 Sep', price: 114, status: 'Peak Window', region: 'Noida Tier-IV', savings: 35, nodes: 11 },
      { id: 'l40-30-5', label: 'Day 13', fullDate: '29 Sep', price: 102, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 42, nodes: 19 },
      { id: 'l40-30-6', label: 'Day 16', fullDate: '02 Oct', price: 88, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 50, nodes: 31 },
      { id: 'l40-30-7', label: 'Day 19', fullDate: '05 Oct', price: 106, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 39, nodes: 16 },
      { id: 'l40-30-8', label: 'Day 22', fullDate: '08 Oct', price: 115, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 34, nodes: 10 },
      { id: 'l40-30-9', label: 'Day 25', fullDate: '11 Oct', price: 95, status: 'Optimal', region: 'Noida Tier-IV', savings: 46, nodes: 25 },
      { id: 'l40-30-10', label: 'Today', fullDate: '16 Oct (Today)', price: 100, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 43, nodes: 22 },
    ],
    '90d': [
      { id: 'l40-90-1', label: 'W1', fullDate: 'Week 1 · Late July', price: 96, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 45, nodes: 23 },
      { id: 'l40-90-2', label: 'W2', fullDate: 'Week 2 · Early Aug', price: 108, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 38, nodes: 15 },
      { id: 'l40-90-3', label: 'W3', fullDate: 'Week 3 · Mid Aug', price: 101, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 42, nodes: 20 },
      { id: 'l40-90-4', label: 'W4', fullDate: 'Week 4 · Late Aug', price: 90, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 49, nodes: 28 },
      { id: 'l40-90-5', label: 'W5', fullDate: 'Week 5 · Early Sep', price: 104, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 41, nodes: 18 },
      { id: 'l40-90-6', label: 'W6', fullDate: 'Week 6 · Mid Sep', price: 116, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 33, nodes: 9 },
      { id: 'l40-90-7', label: 'W7', fullDate: 'Week 7 · Late Sep', price: 105, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 40, nodes: 17 },
      { id: 'l40-90-8', label: 'W8', fullDate: 'Week 8 · End Sep', price: 89, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 50, nodes: 30 },
      { id: 'l40-90-9', label: 'W9', fullDate: 'Week 9 · Early Oct', price: 99, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 44, nodes: 21 },
      { id: 'l40-90-10', label: 'W10', fullDate: 'Week 10 · Mid Oct', price: 109, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 37, nodes: 13 },
      { id: 'l40-90-11', label: 'W11', fullDate: 'Week 11 · Past Week', price: 118, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 32, nodes: 8 },
      { id: 'l40-90-12', label: 'Now', fullDate: 'Current Week (Now)', price: 100, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 43, nodes: 22 },
    ],
    '1y': [
      { id: 'l40-1y-1', label: 'Nov', fullDate: 'Nov 2025', price: 112, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 36, nodes: 12 },
      { id: 'l40-1y-2', label: 'Dec', fullDate: 'Dec 2025', price: 106, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 39, nodes: 16 },
      { id: 'l40-1y-3', label: 'Jan', fullDate: 'Jan 2026', price: 95, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 24 },
      { id: 'l40-1y-4', label: 'Feb', fullDate: 'Feb 2026', price: 92, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 48, nodes: 27 },
      { id: 'l40-1y-5', label: 'Mar', fullDate: 'Mar 2026', price: 98, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 44, nodes: 22 },
      { id: 'l40-1y-6', label: 'Apr', fullDate: 'Apr 2026', price: 104, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 41, nodes: 18 },
      { id: 'l40-1y-7', label: 'May', fullDate: 'May 2026', price: 101, status: 'Optimal', region: 'Hyderabad ap-south-2', savings: 42, nodes: 20 },
      { id: 'l40-1y-8', label: 'Jun', fullDate: 'Jun 2026', price: 94, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 47, nodes: 25 },
      { id: 'l40-1y-9', label: 'Jul', fullDate: 'Jul 2026', price: 97, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 45, nodes: 23 },
      { id: 'l40-1y-10', label: 'Aug', fullDate: 'Aug 2026', price: 102, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 42, nodes: 19 },
      { id: 'l40-1y-11', label: 'Sep', fullDate: 'Sep 2026', price: 106, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 39, nodes: 16 },
      { id: 'l40-1y-12', label: 'Oct', fullDate: 'Oct 2026', price: 100, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 43, nodes: 22 },
    ],
  },
  A100: {
    '7d': [
      { id: 'a100-7-1', label: 'Mon', fullDate: 'Monday, 10 Oct', price: 212, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 41, nodes: 16 },
      { id: 'a100-7-2', label: 'Tue', fullDate: 'Tuesday, 11 Oct', price: 225, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 36, nodes: 11 },
      { id: 'a100-7-3', label: 'Wed', fullDate: 'Wednesday, 12 Oct', price: 232, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 33, nodes: 8 },
      { id: 'a100-7-4', label: 'Thu', fullDate: 'Thursday, 13 Oct', price: 220, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 38, nodes: 14 },
      { id: 'a100-7-5', label: 'Fri', fullDate: 'Friday, 14 Oct', price: 215, status: 'Optimal', region: 'Noida Tier-IV', savings: 40, nodes: 18 },
      { id: 'a100-7-6', label: 'Sat', fullDate: 'Saturday, 15 Oct', price: 198, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 46, nodes: 24 },
      { id: 'a100-7-7', label: 'Today', fullDate: 'Sunday, 16 Oct (Today)', price: 194, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 48, nodes: 28 },
    ],
    '30d': [
      { id: 'a100-30-1', label: 'Day 1', fullDate: '17 Sep', price: 200, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 45, nodes: 21 },
      { id: 'a100-30-2', label: 'Day 4', fullDate: '20 Sep', price: 224, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 37, nodes: 13 },
      { id: 'a100-30-3', label: 'Day 7', fullDate: '23 Sep', price: 210, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 42, nodes: 17 },
      { id: 'a100-30-4', label: 'Day 10', fullDate: '26 Sep', price: 230, status: 'Peak Window', region: 'Noida Tier-IV', savings: 34, nodes: 9 },
      { id: 'a100-30-5', label: 'Day 13', fullDate: '29 Sep', price: 218, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 39, nodes: 15 },
      { id: 'a100-30-6', label: 'Day 16', fullDate: '02 Oct', price: 195, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 47, nodes: 25 },
      { id: 'a100-30-7', label: 'Day 19', fullDate: '05 Oct', price: 222, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 38, nodes: 14 },
      { id: 'a100-30-8', label: 'Day 22', fullDate: '08 Oct', price: 234, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 32, nodes: 8 },
      { id: 'a100-30-9', label: 'Day 25', fullDate: '11 Oct', price: 208, status: 'Optimal', region: 'Noida Tier-IV', savings: 43, nodes: 19 },
      { id: 'a100-30-10', label: 'Today', fullDate: '16 Oct (Today)', price: 210, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 42, nodes: 18 },
    ],
    '90d': [
      { id: 'a100-90-1', label: 'W1', fullDate: 'Week 1 · Late July', price: 205, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 43, nodes: 18 },
      { id: 'a100-90-2', label: 'W2', fullDate: 'Week 2 · Early Aug', price: 226, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 36, nodes: 12 },
      { id: 'a100-90-3', label: 'W3', fullDate: 'Week 3 · Mid Aug', price: 215, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 40, nodes: 16 },
      { id: 'a100-90-4', label: 'W4', fullDate: 'Week 4 · Late Aug', price: 198, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 46, nodes: 23 },
      { id: 'a100-90-5', label: 'W5', fullDate: 'Week 5 · Early Sep', price: 220, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 38, nodes: 14 },
      { id: 'a100-90-6', label: 'W6', fullDate: 'Week 6 · Mid Sep', price: 235, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 32, nodes: 7 },
      { id: 'a100-90-7', label: 'W7', fullDate: 'Week 7 · Late Sep', price: 222, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 38, nodes: 13 },
      { id: 'a100-90-8', label: 'W8', fullDate: 'Week 8 · End Sep', price: 196, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 47, nodes: 24 },
      { id: 'a100-90-9', label: 'W9', fullDate: 'Week 9 · Early Oct', price: 212, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 41, nodes: 17 },
      { id: 'a100-90-10', label: 'W10', fullDate: 'Week 10 · Mid Oct', price: 228, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 35, nodes: 10 },
      { id: 'a100-90-11', label: 'W11', fullDate: 'Week 11 · Past Week', price: 238, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 31, nodes: 6 },
      { id: 'a100-90-12', label: 'Now', fullDate: 'Current Week (Now)', price: 210, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 42, nodes: 18 },
    ],
    '1y': [
      { id: 'a100-1y-1', label: 'Nov', fullDate: 'Nov 2025', price: 230, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 34, nodes: 10 },
      { id: 'a100-1y-2', label: 'Dec', fullDate: 'Dec 2025', price: 222, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 38, nodes: 13 },
      { id: 'a100-1y-3', label: 'Jan', fullDate: 'Jan 2026', price: 205, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 43, nodes: 19 },
      { id: 'a100-1y-4', label: 'Feb', fullDate: 'Feb 2026', price: 198, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 46, nodes: 22 },
      { id: 'a100-1y-5', label: 'Mar', fullDate: 'Mar 2026', price: 208, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 42, nodes: 18 },
      { id: 'a100-1y-6', label: 'Apr', fullDate: 'Apr 2026', price: 218, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 39, nodes: 15 },
      { id: 'a100-1y-7', label: 'May', fullDate: 'May 2026', price: 212, status: 'Optimal', region: 'Hyderabad ap-south-2', savings: 41, nodes: 17 },
      { id: 'a100-1y-8', label: 'Jun', fullDate: 'Jun 2026', price: 202, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 44, nodes: 20 },
      { id: 'a100-1y-9', label: 'Jul', fullDate: 'Jul 2026', price: 206, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 43, nodes: 18 },
      { id: 'a100-1y-10', label: 'Aug', fullDate: 'Aug 2026', price: 214, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 40, nodes: 16 },
      { id: 'a100-1y-11', label: 'Sep', fullDate: 'Sep 2026', price: 220, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 38, nodes: 14 },
      { id: 'a100-1y-12', label: 'Oct', fullDate: 'Oct 2026', price: 210, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 42, nodes: 18 },
    ],
  },
  H100: {
    '7d': [
      { id: 'h100-7-1', label: 'Mon', fullDate: 'Monday, 10 Oct', price: 280, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 44, nodes: 14 },
      { id: 'h100-7-2', label: 'Tue', fullDate: 'Tuesday, 11 Oct', price: 292, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 39, nodes: 8 },
      { id: 'h100-7-3', label: 'Wed', fullDate: 'Wednesday, 12 Oct', price: 298, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 37, nodes: 5 },
      { id: 'h100-7-4', label: 'Thu', fullDate: 'Thursday, 13 Oct', price: 285, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 42, nodes: 11 },
      { id: 'h100-7-5', label: 'Fri', fullDate: 'Friday, 14 Oct', price: 275, status: 'Optimal', region: 'Noida Tier-IV', savings: 46, nodes: 16 },
      { id: 'h100-7-6', label: 'Sat', fullDate: 'Saturday, 15 Oct', price: 252, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 52, nodes: 22 },
      { id: 'h100-7-7', label: 'Today', fullDate: 'Sunday, 16 Oct (Today)', price: 246, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 54, nodes: 26 },
    ],
    '30d': [
      { id: 'h100-30-1', label: 'Day 1', fullDate: '17 Sep', price: 260, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 49, nodes: 19 },
      { id: 'h100-30-2', label: 'Day 4', fullDate: '20 Sep', price: 288, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 41, nodes: 10 },
      { id: 'h100-30-3', label: 'Day 7', fullDate: '23 Sep', price: 272, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 15 },
      { id: 'h100-30-4', label: 'Day 10', fullDate: '26 Sep', price: 296, status: 'Peak Window', region: 'Noida Tier-IV', savings: 38, nodes: 6 },
      { id: 'h100-30-5', label: 'Day 13', fullDate: '29 Sep', price: 280, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 44, nodes: 12 },
      { id: 'h100-30-6', label: 'Day 16', fullDate: '02 Oct', price: 248, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 53, nodes: 24 },
      { id: 'h100-30-7', label: 'Day 19', fullDate: '05 Oct', price: 284, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 42, nodes: 11 },
      { id: 'h100-30-8', label: 'Day 22', fullDate: '08 Oct', price: 298, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 37, nodes: 5 },
      { id: 'h100-30-9', label: 'Day 25', fullDate: '11 Oct', price: 268, status: 'Optimal', region: 'Noida Tier-IV', savings: 47, nodes: 17 },
      { id: 'h100-30-10', label: 'Today', fullDate: '16 Oct (Today)', price: 275, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 16 },
    ],
    '90d': [
      { id: 'h100-90-1', label: 'W1', fullDate: 'Week 1 · Late July', price: 265, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 48, nodes: 17 },
      { id: 'h100-90-2', label: 'W2', fullDate: 'Week 2 · Early Aug', price: 290, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 40, nodes: 9 },
      { id: 'h100-90-3', label: 'W3', fullDate: 'Week 3 · Mid Aug', price: 276, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 45, nodes: 13 },
      { id: 'h100-90-4', label: 'W4', fullDate: 'Week 4 · Late Aug', price: 252, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 52, nodes: 21 },
      { id: 'h100-90-5', label: 'W5', fullDate: 'Week 5 · Early Sep', price: 282, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 43, nodes: 12 },
      { id: 'h100-90-6', label: 'W6', fullDate: 'Week 6 · Mid Sep', price: 302, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 36, nodes: 4 },
      { id: 'h100-90-7', label: 'W7', fullDate: 'Week 7 · Late Sep', price: 286, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 41, nodes: 10 },
      { id: 'h100-90-8', label: 'W8', fullDate: 'Week 8 · End Sep', price: 250, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 53, nodes: 23 },
      { id: 'h100-90-9', label: 'W9', fullDate: 'Week 9 · Early Oct', price: 272, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 15 },
      { id: 'h100-90-10', label: 'W10', fullDate: 'Week 10 · Mid Oct', price: 294, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 39, nodes: 7 },
      { id: 'h100-90-11', label: 'W11', fullDate: 'Week 11 · Past Week', price: 305, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 34, nodes: 3 },
      { id: 'h100-90-12', label: 'Now', fullDate: 'Current Week (Now)', price: 275, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 16 },
    ],
    '1y': [
      { id: 'h100-1y-1', label: 'Nov', fullDate: 'Nov 2025', price: 295, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 38, nodes: 7 },
      { id: 'h100-1y-2', label: 'Dec', fullDate: 'Dec 2025', price: 288, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 41, nodes: 10 },
      { id: 'h100-1y-3', label: 'Jan', fullDate: 'Jan 2026', price: 268, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 16 },
      { id: 'h100-1y-4', label: 'Feb', fullDate: 'Feb 2026', price: 258, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 50, nodes: 20 },
      { id: 'h100-1y-5', label: 'Mar', fullDate: 'Mar 2026', price: 270, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 15 },
      { id: 'h100-1y-6', label: 'Apr', fullDate: 'Apr 2026', price: 284, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 42, nodes: 11 },
      { id: 'h100-1y-7', label: 'May', fullDate: 'May 2026', price: 278, status: 'Optimal', region: 'Hyderabad ap-south-2', savings: 44, nodes: 13 },
      { id: 'h100-1y-8', label: 'Jun', fullDate: 'Jun 2026', price: 264, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 48, nodes: 18 },
      { id: 'h100-1y-9', label: 'Jul', fullDate: 'Jul 2026', price: 272, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 15 },
      { id: 'h100-1y-10', label: 'Aug', fullDate: 'Aug 2026', price: 280, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 43, nodes: 12 },
      { id: 'h100-1y-11', label: 'Sep', fullDate: 'Sep 2026', price: 290, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 40, nodes: 9 },
      { id: 'h100-1y-12', label: 'Oct', fullDate: 'Oct 2026', price: 275, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 46, nodes: 16 },
    ],
  },
  H200: {
    '7d': [
      { id: 'h200-7-1', label: 'Mon', fullDate: 'Monday, 10 Oct', price: 348, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 46, nodes: 10 },
      { id: 'h200-7-2', label: 'Tue', fullDate: 'Tuesday, 11 Oct', price: 362, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 42, nodes: 5 },
      { id: 'h200-7-3', label: 'Wed', fullDate: 'Wednesday, 12 Oct', price: 370, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 40, nodes: 3 },
      { id: 'h200-7-4', label: 'Thu', fullDate: 'Thursday, 13 Oct', price: 355, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 44, nodes: 7 },
      { id: 'h200-7-5', label: 'Fri', fullDate: 'Friday, 14 Oct', price: 340, status: 'Optimal', region: 'Noida Tier-IV', savings: 47, nodes: 12 },
      { id: 'h200-7-6', label: 'Sat', fullDate: 'Saturday, 15 Oct', price: 318, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 52, nodes: 16 },
      { id: 'h200-7-7', label: 'Today', fullDate: 'Sunday, 16 Oct (Today)', price: 312, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 54, nodes: 18 },
    ],
    '30d': [
      { id: 'h200-30-1', label: 'Day 1', fullDate: '17 Sep', price: 325, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 50, nodes: 14 },
      { id: 'h200-30-2', label: 'Day 4', fullDate: '20 Sep', price: 358, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 43, nodes: 6 },
      { id: 'h200-30-3', label: 'Day 7', fullDate: '23 Sep', price: 338, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 11 },
      { id: 'h200-30-4', label: 'Day 10', fullDate: '26 Sep', price: 368, status: 'Peak Window', region: 'Noida Tier-IV', savings: 41, nodes: 4 },
      { id: 'h200-30-5', label: 'Day 13', fullDate: '29 Sep', price: 350, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 45, nodes: 8 },
      { id: 'h200-30-6', label: 'Day 16', fullDate: '02 Oct', price: 315, status: 'Off-Peak Discount', region: 'Mumbai ap-south-1', savings: 53, nodes: 17 },
      { id: 'h200-30-7', label: 'Day 19', fullDate: '05 Oct', price: 354, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 44, nodes: 7 },
      { id: 'h200-30-8', label: 'Day 22', fullDate: '08 Oct', price: 372, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 39, nodes: 3 },
      { id: 'h200-30-9', label: 'Day 25', fullDate: '11 Oct', price: 335, status: 'Optimal', region: 'Noida Tier-IV', savings: 48, nodes: 12 },
      { id: 'h200-30-10', label: 'Today', fullDate: '16 Oct (Today)', price: 340, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 11 },
    ],
    '90d': [
      { id: 'h200-90-1', label: 'W1', fullDate: 'Week 1 · Late July', price: 330, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 49, nodes: 13 },
      { id: 'h200-90-2', label: 'W2', fullDate: 'Week 2 · Early Aug', price: 362, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 42, nodes: 5 },
      { id: 'h200-90-3', label: 'W3', fullDate: 'Week 3 · Mid Aug', price: 344, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 46, nodes: 9 },
      { id: 'h200-90-4', label: 'W4', fullDate: 'Week 4 · Late Aug', price: 320, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 52, nodes: 15 },
      { id: 'h200-90-5', label: 'W5', fullDate: 'Week 5 · Early Sep', price: 352, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 44, nodes: 8 },
      { id: 'h200-90-6', label: 'W6', fullDate: 'Week 6 · Mid Sep', price: 376, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 38, nodes: 2 },
      { id: 'h200-90-7', label: 'W7', fullDate: 'Week 7 · Late Sep', price: 358, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 43, nodes: 6 },
      { id: 'h200-90-8', label: 'W8', fullDate: 'Week 8 · End Sep', price: 318, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 53, nodes: 16 },
      { id: 'h200-90-9', label: 'W9', fullDate: 'Week 9 · Early Oct', price: 342, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 10 },
      { id: 'h200-90-10', label: 'W10', fullDate: 'Week 10 · Mid Oct', price: 366, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 41, nodes: 4 },
      { id: 'h200-90-11', label: 'W11', fullDate: 'Week 11 · Past Week', price: 380, status: 'Peak Window', region: 'Hyderabad ap-south-2', savings: 37, nodes: 2 },
      { id: 'h200-90-12', label: 'Now', fullDate: 'Current Week (Now)', price: 340, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 12 },
    ],
    '1y': [
      { id: 'h200-1y-1', label: 'Nov', fullDate: 'Nov 2025', price: 370, status: 'Peak Window', region: 'Mumbai ap-south-1', savings: 40, nodes: 4 },
      { id: 'h200-1y-2', label: 'Dec', fullDate: 'Dec 2025', price: 360, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 43, nodes: 6 },
      { id: 'h200-1y-3', label: 'Jan', fullDate: 'Jan 2026', price: 335, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 48, nodes: 12 },
      { id: 'h200-1y-4', label: 'Feb', fullDate: 'Feb 2026', price: 325, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 51, nodes: 14 },
      { id: 'h200-1y-5', label: 'Mar', fullDate: 'Mar 2026', price: 338, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 11 },
      { id: 'h200-1y-6', label: 'Apr', fullDate: 'Apr 2026', price: 352, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 44, nodes: 8 },
      { id: 'h200-1y-7', label: 'May', fullDate: 'May 2026', price: 346, status: 'Optimal', region: 'Hyderabad ap-south-2', savings: 46, nodes: 9 },
      { id: 'h200-1y-8', label: 'Jun', fullDate: 'Jun 2026', price: 330, status: 'Off-Peak Discount', region: 'Noida Tier-IV', savings: 50, nodes: 13 },
      { id: 'h200-1y-9', label: 'Jul', fullDate: 'Jul 2026', price: 340, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 11 },
      { id: 'h200-1y-10', label: 'Aug', fullDate: 'Aug 2026', price: 350, status: 'Nominal', region: 'Mumbai ap-south-1', savings: 45, nodes: 8 },
      { id: 'h200-1y-11', label: 'Sep', fullDate: 'Sep 2026', price: 362, status: 'Nominal', region: 'Hyderabad ap-south-2', savings: 42, nodes: 5 },
      { id: 'h200-1y-12', label: 'Oct', fullDate: 'Oct 2026', price: 340, status: 'Optimal', region: 'Mumbai ap-south-1', savings: 47, nodes: 12 },
    ],
  },
}

export interface InteractivePriceHistoryChartProps {
  gpu: GpuModel
  range: PriceHistoryRange
  onGpuChange?: (gpu: GpuModel) => void
  onRangeChange?: (range: PriceHistoryRange) => void
  /**
   * Optional externally supplied historical pricing records.
   * Accepts either a flat array for the active `(gpu, range)` or a nested dataset map.
   * When omitted (`undefined`), displays illustrative DEMO DATA with a visible badge.
   * When explicitly `null` or empty (`[]`), renders an empty state rather than claiming demo history is stored.
   */
  historyData?: PricePoint[] | PriceHistoryDataset | null
  /** Optional current hourly rate (₹/hr) supplied by the backend GPU inventory/catalog */
  currentHourlyRate?: number | null
  /** Optional label for the backend current rate (e.g. 'Backend Inventory') */
  currentRateSource?: string
  /** Explicit data source mode; defaults to 'demo' when `historyData` is undefined, else 'live'. */
  dataSource?: PriceDataSource
  /** Loading state while fetching pricing data */
  loading?: boolean
  /** Unavailable state when pricing backend cannot be reached */
  unavailable?: boolean
  /** Message displayed when `unavailable` is true */
  unavailableMessage?: string
  /** Explicit error message when a pricing query fails */
  error?: string | null
  /** Show or hide the "Deploy {gpu}" CTA (defaults to true for backward compatibility) */
  showDeployAction?: boolean
  /** Available GPU model selector options */
  gpuModels?: GpuModel[]
  /** Maximum number of rendered bar columns before LTTB downsampling applies (default 24) */
  maxBars?: number
}

const DEFAULT_GPU_MODELS: GpuModel[] = ['L4', 'L40S', 'A100', 'H100', 'H200']
const RANGE_OPTIONS: readonly PriceHistoryRange[] = ['7d', '30d', '90d', '1y']
const SKELETON_BAR_HEIGHTS: readonly number[] = [42, 58, 50, 72, 64, 80, 56, 68, 76, 60]

const SR_ONLY_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

function InteractivePriceHistoryChartInner({
  gpu,
  range,
  onGpuChange,
  onRangeChange,
  historyData,
  currentHourlyRate = null,
  currentRateSource = 'Backend Catalog',
  dataSource,
  loading = false,
  unavailable = false,
  unavailableMessage = 'Historical GPU pricing data is currently unavailable from the backend.',
  error = null,
  showDeployAction = true,
  gpuModels = DEFAULT_GPU_MODELS,
  maxBars = 24,
}: InteractivePriceHistoryChartProps) {
  const navigate = useNavigate()
  const chartHeadingId = useId()
  const barsContainerRef = useRef<HTMLDivElement | null>(null)
  const barRefs = useRef<Array<HTMLDivElement | null>>([])

  const [containerWidth, setContainerWidth] = useState<number>(0)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false)

  const isUsingDemoFallback = historyData === undefined
  const effectiveSource: PriceDataSource =
    dataSource ?? (isUsingDemoFallback ? 'demo' : 'live')
  const isDemo = effectiveSource === 'demo'

  const rawData: PricePoint[] = useMemo(() => {
    if (isUsingDemoFallback) {
      return PRICE_DATA[gpu]?.[range] || PRICE_DATA.L40S['30d']
    }
    if (historyData === null) {
      return []
    }
    if (Array.isArray(historyData)) {
      return historyData
    }
    return historyData[gpu]?.[range] ?? []
  }, [gpu, range, historyData, isUsingDemoFallback])

  const hasError = Boolean(error && error.trim().length > 0)
  const hasBars = !loading && !hasError && !unavailable && rawData.length > 0

  // Measure chart container width via ResizeObserver (only re-renders on integer width changes)
  useEffect(() => {
    const el = barsContainerRef.current
    if (!el || !hasBars) return

    const updateWidth = () => {
      const next = Math.round(el.getBoundingClientRect().width)
      if (next > 0) {
        setContainerWidth((prev) => (prev === next ? prev : next))
      }
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.round(entry.contentRect.width)
        if (next > 0) {
          setContainerWidth((prev) => (prev === next ? prev : next))
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBars])

  // Respect user's reduced-motion preference
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setPrefersReducedMotion(mq.matches)
    sync()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    return undefined
  }, [])

  // Responsive bar budget prevents DOM overload & overlapping columns on narrow screens
  const isCompact = containerWidth > 0 && containerWidth < 460
  const isTablet = containerWidth >= 460 && containerWidth < 768
  const normalizedMaxBars = Math.max(4, Math.floor(maxBars))
  const effectiveMaxBars =
    containerWidth > 0 && containerWidth <= 420
      ? Math.min(normalizedMaxBars, 12)
      : containerWidth > 0 && containerWidth <= 720
        ? Math.min(normalizedMaxBars, 18)
        : normalizedMaxBars

  const isDownsampled = rawData.length > effectiveMaxBars
  const data: PricePoint[] = useMemo(() => {
    if (!isDownsampled) return rawData
    return downsampleLTTB(rawData, effectiveMaxBars, (p) => p.price)
  }, [rawData, isDownsampled, effectiveMaxBars])

  // Active / hovered / keyboard-focused point state
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(Math.max(0, data.length - 1))

  // Reset transient hover/focus and clamp selection cleanly when dataset changes
  useEffect(() => {
    setHoveredIdx((prev) => (prev === null ? prev : null))
    setFocusedIdx((prev) => (prev === null ? prev : null))
    const defaultIdx = Math.max(0, data.length - 1)
    setSelectedIdx((prev) => (prev === defaultIdx ? prev : defaultIdx))
    barRefs.current = barRefs.current.slice(0, data.length)
  }, [gpu, range, data.length])

  // Tooltip shows for either hovered or keyboard-focused bar
  const tooltipIdx =
    hoveredIdx !== null && hoveredIdx < data.length
      ? hoveredIdx
      : focusedIdx !== null && focusedIdx < data.length
        ? focusedIdx
        : null

  // Ensure active index is always in bounds
  const activeIdx =
    data.length === 0
      ? -1
      : tooltipIdx !== null
        ? tooltipIdx
        : selectedIdx < data.length
          ? selectedIdx
          : data.length - 1
  const activePoint = activeIdx >= 0 ? data[activeIdx] : null
  const tooltipPoint = tooltipIdx !== null ? data[tooltipIdx] : null

  const hasBackendCurrentRate =
    typeof currentHourlyRate === 'number' && Number.isFinite(currentHourlyRate) && currentHourlyRate > 0

  // Min, Max, and Average are computed strictly over the FULL raw dataset (before downsampling)
  const { minPrice, maxPrice, avgPrice } = useMemo(() => {
    if (rawData.length === 0) {
      return { minPrice: 0, maxPrice: 0, avgPrice: 0 }
    }
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const p of rawData) {
      if (p.price < min) min = p.price
      if (p.price > max) max = p.price
      sum += p.price
    }
    const avg = Math.round(sum / rawData.length)
    return { minPrice: min, maxPrice: max, avgPrice: avg }
  }, [rawData])

  // Scale bar heights cleanly between 26% and 90%
  const getBarHeight = useCallback(
    (price: number) => {
      if (maxPrice === minPrice) return 60
      const ratio = (price - minPrice) / (maxPrice - minPrice)
      return Math.round(26 + ratio * 64)
    },
    [minPrice, maxPrice],
  )

  const barHeights = useMemo(() => data.map((p) => getBarHeight(p.price)), [data, getBarHeight])
  const avgHeight = rawData.length > 0 ? getBarHeight(avgPrice) : 50

  const rangeTitle =
    range === '7d' ? '7-Day' : range === '30d' ? '30-Day' : range === '90d' ? '90-Day Quarter' : '1-Year Annual'

  const displayedCurrentPrice = hasBackendCurrentRate
    ? currentHourlyRate
    : activePoint
      ? activePoint.price
      : null

  // Responsive padding, gap, and X-axis label thinning
  const padX = isCompact ? 10 : isTablet ? 14 : 18
  const barGap = isCompact
    ? data.length > 8
      ? 4
      : 8
    : data.length > 14
      ? 5
      : data.length > 10
        ? 8
        : 14

  const labelStep = useMemo(() => {
    if (isCompact) {
      if (data.length > 10) return Math.ceil(data.length / 5)
      if (data.length > 7) return 2
      return 1
    }
    if (isTablet) {
      return data.length > 12 ? Math.ceil(data.length / 8) : 1
    }
    return data.length > 14 ? Math.ceil(data.length / 10) : 1
  }, [isCompact, isTablet, data.length])

  // Compute horizontally clamped floating tooltip position (zero left/right clipping)
  const clampedTooltip = useMemo(() => {
    if (tooltipIdx === null || !tooltipPoint || data.length === 0) return null
    const effectiveWidth = containerWidth > 0 ? containerWidth : 640
    const tooltipWidth = Math.min(isCompact ? 176 : 196, Math.max(140, effectiveWidth - 16))
    const barEl = barRefs.current[tooltipIdx]
    const anchorX =
      barEl && barEl.offsetWidth > 0
        ? barEl.offsetLeft + barEl.offsetWidth / 2
        : padX + ((tooltipIdx + 0.5) / data.length) * Math.max(1, effectiveWidth - padX * 2)

    const pos = clampTooltipHorizontal({
      anchorX,
      containerWidth: effectiveWidth,
      tooltipWidth,
      offset: 10,
      edgePadding: 8,
    })

    const delta = tooltipPoint.price - avgPrice
    const deltaPct = avgPrice > 0 ? ((delta / avgPrice) * 100).toFixed(1) : '0.0'

    return {
      leftPx: pos.leftPx,
      maxWidth: Math.max(140, effectiveWidth - 16),
      point: tooltipPoint,
      delta,
      deltaPct,
    }
  }, [tooltipIdx, tooltipPoint, data.length, containerWidth, isCompact, padX, avgPrice])

  // Guarded pointer & focus handlers to avoid redundant state updates
  const handleBarEnter = useCallback((idx: number) => {
    setHoveredIdx((prev) => (prev === idx ? prev : idx))
  }, [])

  const handleBarsMouseLeave = useCallback(() => {
    setHoveredIdx((prev) => (prev === null ? prev : null))
  }, [])

  const handleBarSelect = useCallback((idx: number) => {
    setSelectedIdx((prev) => (prev === idx ? prev : idx))
  }, [])

  const handleBarFocus = useCallback((idx: number) => {
    setFocusedIdx((prev) => (prev === idx ? prev : idx))
    setSelectedIdx((prev) => (prev === idx ? prev : idx))
  }, [])

  const handleBarBlur = useCallback((idx: number) => {
    setFocusedIdx((prev) => (prev === idx ? null : prev))
  }, [])

  const handleBarKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, idx: number) => {
      if (data.length === 0) return
      let nextIdx: number | null = null

      if (e.key === 'ArrowRight') {
        nextIdx = Math.min(data.length - 1, idx + 1)
      } else if (e.key === 'ArrowLeft') {
        nextIdx = Math.max(0, idx - 1)
      } else if (e.key === 'Home') {
        nextIdx = 0
      } else if (e.key === 'End') {
        nextIdx = data.length - 1
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setSelectedIdx((prev) => (prev === idx ? prev : idx))
        setFocusedIdx((prev) => (prev === idx ? prev : idx))
        return
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setHoveredIdx(null)
        setFocusedIdx(null)
        return
      } else {
        return
      }

      e.preventDefault()
      if (nextIdx !== null && nextIdx !== idx) {
        setSelectedIdx(nextIdx)
        setFocusedIdx(nextIdx)
        barRefs.current[nextIdx]?.focus()
      }
    },
    [data.length],
  )

  const handleDeployClick = useCallback(() => {
    navigate('/dashboard/gpus')
  }, [navigate])

  const liveAnnouncement = activePoint
    ? `${gpu} ${rangeTitle} ${isDemo ? 'demo sample' : 'stored history'}: ${activePoint.fullDate}, ₹${activePoint.price} per hour, ${activePoint.status}, ${activePoint.region}, ${activePoint.nodes} nodes.`
    : ''

  const chartSummaryLabel = `${gpu} ${rangeTitle} GPU spot price history bar chart (${isDemo ? 'demo sample data' : 'stored historical records'}). ${rawData.length} total data points${isDownsampled ? `, displaying ${data.length} LTTB-sampled bars` : ''}. Lowest ₹${minPrice}/hr, highest ₹${maxPrice}/hr, average ₹${avgPrice}/hr. Use Left and Right arrow keys to inspect individual bars.`

  return (
    <div className="mw-price-history-interactive">
      {/* Dynamic Metric Stat Grid */}
      <div className="mw-stat-grid" style={{ marginBottom: 18 }}>
        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>{hasBackendCurrentRate ? 'Current Hourly Rate' : 'Selected Spot Rate'}</span>
            <span className="mw-icon-box" aria-hidden="true">
              <CircleDollarSign />
            </span>
          </div>
          <strong>{displayedCurrentPrice !== null ? `₹${displayedCurrentPrice}/hr` : '—'}</strong>
          <small style={{ color: hasBackendCurrentRate ? 'var(--brand-hi)' : 'var(--ink-3)' }}>
            {hasBackendCurrentRate
              ? `${currentRateSource} · Live Rate`
              : activePoint
                ? `${activePoint.status} · ${activePoint.region.split(' ')[0]}${isDemo ? ' (Demo)' : ''}`
                : 'No rate available'}
          </small>
        </div>

        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>{rangeTitle} Lowest</span>
            <span className="mw-icon-box" aria-hidden="true">
              <TrendingUp />
            </span>
          </div>
          <strong>{rawData.length > 0 ? `₹${minPrice}/hr` : '—'}</strong>
          <small>{isDemo ? 'Illustrative off-peak sample' : 'Lowest recorded rate'}</small>
        </div>

        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>{rangeTitle} Highest</span>
            <span className="mw-icon-box" aria-hidden="true">
              <Activity />
            </span>
          </div>
          <strong>{rawData.length > 0 ? `₹${maxPrice}/hr` : '—'}</strong>
          <small>{isDemo ? 'Illustrative peak sample' : 'Highest recorded rate'}</small>
        </div>

        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>Market Savings</span>
            <span className="mw-icon-box" aria-hidden="true">
              <Zap />
            </span>
          </div>
          <strong style={{ color: 'var(--brand-hi)' }}>
            {activePoint ? `~${activePoint.savings}% vs Hyperscalers` : '—'}
          </strong>
          <small>{isDemo ? 'Illustrative ap-south-1 benchmark' : 'Compared to AWS / GCP ap-south-1'}</small>
        </div>
      </div>

      {/* Main Interactive Chart Panel */}
      <div className="mw-panel" aria-labelledby={chartHeadingId}>
        <div className="mw-panel-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 id={chartHeadingId} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{gpu} Spot Price Trend</span>
              {rawData.length > 0 && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(118, 185, 0, 0.14)',
                    color: 'var(--brand-hi)',
                    border: '1px solid rgba(118, 185, 0, 0.3)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {isDownsampled
                    ? `${rangeTitle} (${rawData.length} pts · ${data.length} shown)`
                    : `${rangeTitle} (${rawData.length} data points)`}
                </span>
              )}
              {isDemo ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.64rem',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontFamily: 'var(--font-mono)',
                    background: 'rgba(245, 158, 11, 0.16)',
                    color: '#f59e0b',
                    border: '1px solid rgba(245, 158, 11, 0.38)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                  title="Illustrative sample historical prices (not backed by stored database records)"
                >
                  <Database size={10} aria-hidden="true" />
                  <span>DEMO DATA</span>
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.64rem',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontFamily: 'var(--font-mono)',
                    background: 'rgba(16, 185, 129, 0.16)',
                    color: '#10b981',
                    border: '1px solid rgba(16, 185, 129, 0.38)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  <CheckCircle2 size={10} aria-hidden="true" />
                  <span>STORED HISTORY</span>
                </span>
              )}
            </h3>
            <span className="mw-muted">
              {isDemo
                ? 'Hover, tap, or use arrow keys to inspect illustrative sample spot rates across windows'
                : 'Hover, tap, or use arrow keys to inspect stored historical hourly rates'}
            </span>
          </div>

          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {rawData.length > 0 && (
              <span style={{ fontSize: '0.72rem', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                Avg: ₹{avgPrice}/hr
              </span>
            )}
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }} role="group" aria-label="Price history timeframe">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`mw-filter-pill ${range === r ? 'is-active' : ''}`}
                  onClick={() => onRangeChange?.(r)}
                  aria-pressed={range === r}
                  aria-label={`Show ${r} price history`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* GPU Filter Bar inside panel */}
        <div
          className="mw-filter-bar"
          role="tablist"
          aria-label="GPU hardware model filter"
          style={{
            padding: isCompact ? '10px 12px' : '10px 18px',
            borderBottom: '1px solid var(--line)',
            background: 'rgba(0, 0, 0, 0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)', fontWeight: 500 }}>
            Selected Hardware:
          </span>
          {gpuModels.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={gpu === m}
              className={`mw-filter-pill ${gpu === m ? 'is-active' : ''}`}
              onClick={() => onGpuChange?.(m)}
              aria-label={`Select ${m} GPU`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Screen-reader polite announcement for keyboard / click bar inspection */}
        <div aria-live="polite" aria-atomic="true" style={SR_ONLY_STYLE}>
          {liveAnnouncement}
        </div>

        {/* ── Loading / Error / Unavailable / Empty States (fixed height to prevent CLS) ── */}
        {loading ? (
          <div role="status" aria-live="polite" aria-label="Loading historical GPU pricing records">
            <div
              className="mw-bars"
              style={{
                height: 220,
                padding: `44px ${padX}px 16px`,
                gap: isCompact ? 6 : 12,
                alignItems: 'flex-end',
              }}
            >
              {SKELETON_BAR_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 'min(100%, 36px)',
                      height: `${h}%`,
                      borderRadius: '6px 6px 2px 2px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      opacity: prefersReducedMotion ? 0.65 : 0.75,
                    }}
                  />
                  <div
                    style={{
                      width: 24,
                      height: 8,
                      borderRadius: 4,
                      background: 'rgba(255, 255, 255, 0.06)',
                    }}
                  />
                </div>
              ))}
            </div>
            <div
              style={{
                minHeight: 52,
                padding: '12px 18px',
                borderTop: '1px solid var(--line)',
                background: 'rgba(0, 0, 0, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-3)',
                fontSize: '0.8rem',
              }}
            >
              Loading historical GPU pricing records...
            </div>
          </div>
        ) : hasError ? (
          <div
            role="alert"
            style={{
              minHeight: 272,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px 18px',
            }}
          >
            <div
              style={{
                width: '100%',
                padding: '20px 18px',
                borderRadius: 10,
                border: '1px solid rgba(239, 68, 68, 0.35)',
                background: 'rgba(239, 68, 68, 0.07)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: '0.82rem',
              }}
            >
              <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Pricing History Error</div>
                <div style={{ marginTop: 2, color: 'var(--ink-3)' }}>{error}</div>
              </div>
            </div>
          </div>
        ) : unavailable ? (
          <div
            role="alert"
            style={{
              minHeight: 272,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px 18px',
            }}
          >
            <div
              style={{
                width: '100%',
                padding: '20px 18px',
                borderRadius: 10,
                border: '1px solid rgba(239, 68, 68, 0.32)',
                background: 'rgba(239, 68, 68, 0.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: '0.82rem',
              }}
            >
              <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Pricing History Unavailable</div>
                <div style={{ marginTop: 2, color: 'var(--ink-3)' }}>{unavailableMessage}</div>
              </div>
            </div>
          </div>
        ) : !activePoint ? (
          <div
            role="status"
            style={{
              minHeight: 272,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px 18px',
            }}
          >
            <div
              style={{
                width: '100%',
                padding: '36px 18px',
                borderRadius: 10,
                border: '1px dashed var(--line-2, rgba(255,255,255,0.12))',
                textAlign: 'center',
                color: 'var(--ink-3)',
                fontSize: '0.82rem',
              }}
            >
              <CircleDollarSign size={22} style={{ opacity: 0.5, margin: '0 auto 8px' }} aria-hidden="true" />
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No Stored Historical Pricing Records</div>
              <div style={{ marginTop: 4 }}>
                No historical pricing data points are stored yet for {gpu} ({rangeTitle}).
                {hasBackendCurrentRate ? ` Current catalog rate is ₹${currentHourlyRate}/hr.` : ''}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ── Interactive Bar Chart Area ──────────────────────── */}
            <div
              ref={barsContainerRef}
              className="mw-bars"
              role="region"
              aria-label={chartSummaryLabel}
              style={{
                height: 220,
                position: 'relative',
                padding: `44px ${padX}px 16px`,
                gap: barGap,
                overflow: 'hidden',
              }}
              onMouseLeave={handleBarsMouseLeave}
            >
              {/* Dashed Average Guide Line */}
              <div
                className="mw-chart-avg-line"
                aria-hidden="true"
                style={{
                  left: padX,
                  right: padX,
                  bottom: `calc(${avgHeight}% + 18px)`,
                }}
              >
                <span className="mw-chart-avg-tag">Avg ₹{avgPrice}/hr</span>
              </div>

              {/* Single Container-Level Clamped Floating Tooltip (never clips left/right/top) */}
              {clampedTooltip && (
                <div
                  className="mw-bar-tooltip"
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: 6,
                    bottom: 'auto',
                    left: clampedTooltip.leftPx,
                    transform: 'none',
                    animation: 'none',
                    maxWidth: clampedTooltip.maxWidth,
                    whiteSpace: isCompact ? 'normal' : 'nowrap',
                  }}
                >
                  <div className="mw-bar-tooltip__date">{clampedTooltip.point.fullDate}</div>
                  <div className="mw-bar-tooltip__price">
                    ₹{clampedTooltip.point.price}
                    <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--ink-3)' }}>
                      /hr
                    </span>
                  </div>
                  <div className="mw-bar-tooltip__meta" style={{ flexWrap: 'wrap' }}>
                    <span
                      className={`mw-bar-tooltip__badge ${
                        clampedTooltip.point.status === 'Off-Peak Discount'
                          ? 'mw-bar-tooltip__badge--discount'
                          : clampedTooltip.point.status === 'Peak Window'
                            ? 'mw-bar-tooltip__badge--peak'
                            : 'mw-bar-tooltip__badge--optimal'
                      }`}
                    >
                      {clampedTooltip.point.status}
                    </span>
                    <span
                      style={{
                        fontSize: '0.64rem',
                        fontFamily: 'var(--font-mono)',
                        color: clampedTooltip.delta <= 0 ? 'var(--brand-hi)' : '#f59e0b',
                      }}
                    >
                      {clampedTooltip.delta > 0
                        ? `+${clampedTooltip.deltaPct}%`
                        : `${clampedTooltip.deltaPct}%`}
                    </span>
                  </div>
                </div>
              )}

              {/* Render interactive bar columns with roving tabindex & keyboard scrubbing */}
              {data.map((point, i) => {
                const heightPct = barHeights[i]
                const isHovered = hoveredIdx === i
                const isFocused = focusedIdx === i
                const isSelected = selectedIdx === i
                const isActiveBar = isSelected || isHovered || isFocused
                const isTabStop = i === (activeIdx >= 0 ? activeIdx : 0)
                const showLabel =
                  labelStep === 1 ||
                  i === 0 ||
                  i === data.length - 1 ||
                  i % labelStep === 0 ||
                  isActiveBar

                return (
                  <div
                    key={point.id}
                    ref={(el) => {
                      barRefs.current[i] = el
                    }}
                    className={`mw-bar-col ${isActiveBar ? 'is-active' : ''}`}
                    onMouseEnter={() => handleBarEnter(i)}
                    onClick={() => handleBarSelect(i)}
                    onFocus={() => handleBarFocus(i)}
                    onBlur={() => handleBarBlur(i)}
                    onKeyDown={(e) => handleBarKeyDown(e, i)}
                    tabIndex={isTabStop ? 0 : -1}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`${point.fullDate}: ₹${point.price} per hour, ${point.status}, ${point.region}${isDemo ? ', demo sample' : ''}`}
                    style={{
                      position: 'relative',
                      minWidth: 0,
                      outline: 'none',
                      borderRadius: 6,
                      boxShadow: isFocused ? '0 0 0 2px rgba(80, 227, 150, 0.78)' : undefined,
                      transition: prefersReducedMotion ? 'none' : undefined,
                    }}
                  >
                    {/* Animated Bar with highlight cap */}
                    <div
                      className="mw-bar"
                      style={{
                        height: `${heightPct}%`,
                        position: 'relative',
                        transition: prefersReducedMotion
                          ? 'none'
                          : 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, box-shadow 0.2s ease',
                      }}
                    >
                      <div className="mw-bar-cap" />
                    </div>

                    {/* X-Axis Label (thinned cleanly on narrow mobile viewports to avoid collision) */}
                    <small
                      aria-hidden={!showLabel}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: isActiveBar ? 'var(--brand-hi)' : 'var(--ink-4)',
                        fontWeight: isActiveBar ? 700 : 500,
                        fontSize: isCompact ? '0.58rem' : data.length > 10 ? '0.62rem' : '0.7rem',
                        visibility: showLabel ? 'visible' : 'hidden',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                      }}
                    >
                      {point.label}
                    </small>
                  </div>
                )
              })}
            </div>

            {/* ── Inspected Window Action Strip ───────────────── */}
            <div
              style={{
                minHeight: 52,
                padding: isCompact ? '12px 12px' : '12px 18px',
                borderTop: '1px solid var(--line)',
                background: 'rgba(0, 0, 0, 0.15)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <Calendar size={14} style={{ color: 'var(--brand-hi)' }} aria-hidden="true" />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)' }}>
                    {activePoint.fullDate}
                  </span>
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <MapPin size={13} style={{ color: 'var(--ink-3)' }} aria-hidden="true" />
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-2)' }}>{activePoint.region}</span>
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <CheckCircle2 size={13} style={{ color: 'var(--brand-hi)' }} aria-hidden="true" />
                  <span style={{ fontSize: '0.76rem', color: 'var(--ink-2)' }}>
                    {activePoint.nodes} Nodes{isDemo ? ' (Sample)' : ' Available'}
                  </span>
                </div>
              </div>

              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86rem', fontWeight: 700, color: 'var(--ink)' }}>
                  {hasBackendCurrentRate ? 'Current' : 'Spot'}:{' '}
                  <span style={{ color: 'var(--brand-hi)' }}>
                    ₹{hasBackendCurrentRate ? currentHourlyRate : activePoint.price}/hr
                  </span>
                </span>
                {showDeployAction && (
                  <button
                    type="button"
                    className="mw-primary"
                    style={{ padding: '6px 14px', fontSize: '0.76rem' }}
                    onClick={handleDeployClick}
                  >
                    <span>Deploy {gpu}</span>
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <p className="mw-footnote" style={{ marginTop: 10, paddingBottom: 12 }}>
          {isDemo
            ? 'DEMO DATA: Historical spot price bars shown above are illustrative sample figures for UI preview and are not stored database price-history records.'
            : 'Historical prices are sourced from stored backend pricing records across configured GPU datacenter regions.'}
        </p>
      </div>
    </div>
  )
}

export const InteractivePriceHistoryChart = memo(InteractivePriceHistoryChartInner)
InteractivePriceHistoryChart.displayName = 'InteractivePriceHistoryChart'
