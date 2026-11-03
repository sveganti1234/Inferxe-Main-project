import { useState, useMemo } from 'react'
import {
  CircleDollarSign,
  TrendingUp,
  Activity,
  Zap,
  MapPin,
  CheckCircle2,
  Calendar,
  ArrowUpRight,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export type PriceHistoryRange = '7d' | '30d' | '90d' | '1y'
export type GpuModel = 'L4' | 'L40S' | 'A100' | 'H100' | 'H200'

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

// Comprehensive realistic price history dataset for all 5 GPUs across 4 ranges
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

interface InteractivePriceHistoryChartProps {
  gpu: GpuModel
  range: PriceHistoryRange
  onGpuChange?: (gpu: GpuModel) => void
  onRangeChange?: (range: PriceHistoryRange) => void
}

export function InteractivePriceHistoryChart({
  gpu,
  range,
  onGpuChange,
  onRangeChange,
}: InteractivePriceHistoryChartProps) {
  const navigate = useNavigate()
  const data = useMemo(() => PRICE_DATA[gpu]?.[range] || PRICE_DATA.L40S['30d'], [gpu, range])

  // Active / hovered point state
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(data.length - 1)

  // Ensure selected index is valid when switching ranges
  const activeIdx = hoveredIdx !== null ? hoveredIdx : (selectedIdx < data.length ? selectedIdx : data.length - 1)
  const activePoint = data[activeIdx] || data[data.length - 1]

  // Min, Max, and Average for the selected dataset
  const { minPrice, maxPrice, avgPrice } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const p of data) {
      if (p.price < min) min = p.price
      if (p.price > max) max = p.price
      sum += p.price
    }
    const avg = Math.round(sum / data.length)
    return { minPrice: min, maxPrice: max, avgPrice: avg }
  }, [data])

  // Scale bar heights nicely between 25% and 92%
  const getBarHeight = (price: number) => {
    if (maxPrice === minPrice) return 60
    const ratio = (price - minPrice) / (maxPrice - minPrice)
    return Math.round(26 + ratio * 64)
  }

  // Average line height percentage
  const avgHeight = getBarHeight(avgPrice)

  // Range title string
  const rangeTitle = range === '7d' ? '7-Day' : range === '30d' ? '30-Day' : range === '90d' ? '90-Day Quarter' : '1-Year Annual'

  return (
    <div className="mw-price-history-interactive">
      {/* Dynamic Metric Stat Grid */}
      <div className="mw-stat-grid" style={{ marginBottom: 18 }}>
        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>Current Spot Rate</span>
            <span className="mw-icon-box">
              <CircleDollarSign />
            </span>
          </div>
          <strong>₹{activePoint.price}/hr</strong>
          <small style={{ color: 'var(--brand-hi)' }}>
            {activePoint.status} · {activePoint.region.split(' ')[0]}
          </small>
        </div>

        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>{rangeTitle} Lowest</span>
            <span className="mw-icon-box">
              <TrendingUp />
            </span>
          </div>
          <strong>₹{minPrice}/hr</strong>
          <small>Off-peak reservation discount</small>
        </div>

        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>{rangeTitle} Highest</span>
            <span className="mw-icon-box">
              <Activity />
            </span>
          </div>
          <strong>₹{maxPrice}/hr</strong>
          <small>Peak cluster load window</small>
        </div>

        <div className="mw-metric">
          <div className="mw-metric-top">
            <span>Market Savings</span>
            <span className="mw-icon-box">
              <Zap />
            </span>
          </div>
          <strong style={{ color: 'var(--brand-hi)' }}>~{activePoint.savings}% vs Hyperscalers</strong>
          <small>Compared to AWS / GCP ap-south-1</small>
        </div>
      </div>

      {/* Main Interactive Chart Panel */}
      <div className="mw-panel">
        <div className="mw-panel-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{gpu} Spot Price Trend</span>
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
                {rangeTitle} ({data.length} data points)
              </span>
            </h3>
            <span className="mw-muted">
              Hover or tap any bar to inspect historical rates and off-peak spot discounts
            </span>
          </div>

          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
              Avg: ₹{avgPrice}/hr
            </span>
            <div className="row" style={{ gap: 5 }}>
              {(['7d', '30d', '90d', '1y'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`mw-filter-pill ${range === r ? 'is-active' : ''}`}
                  onClick={() => onRangeChange?.(r)}
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
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--line)',
            background: 'rgba(0, 0, 0, 0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)', fontWeight: 500 }}>
            Selected Hardware:
          </span>
          {(['L4', 'L40S', 'A100', 'H100', 'H200'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`mw-filter-pill ${gpu === m ? 'is-active' : ''}`}
              onClick={() => onGpuChange?.(m)}
              aria-label={`Select ${m} GPU`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* ── Interactive Bar Chart Area ──────────────────────── */}
        <div
          className="mw-bars"
          style={{
            height: 220,
            position: 'relative',
            padding: '40px 18px 16px',
            gap: data.length > 10 ? 8 : 14,
          }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Dashed Average Guide Line */}
          <div
            className="mw-chart-avg-line"
            style={{
              bottom: `calc(${avgHeight}% + 18px)`,
            }}
          >
            <span className="mw-chart-avg-tag">
              Avg ₹{avgPrice}/hr
            </span>
          </div>

          {/* Render individual interactive bar columns */}
          {data.map((point, i) => {
            const heightPct = getBarHeight(point.price)
            const isHovered = hoveredIdx === i
            const isSelected = selectedIdx === i
            const delta = point.price - avgPrice
            const deltaPct = ((delta / avgPrice) * 100).toFixed(1)

            return (
              <div
                key={point.id}
                className={`mw-bar-col ${isSelected || isHovered ? 'is-active' : ''}`}
                onMouseEnter={() => setHoveredIdx(i)}
                onClick={() => setSelectedIdx(i)}
                tabIndex={0}
                role="button"
                aria-label={`${point.fullDate}: ₹${point.price}/hr`}
                style={{
                  position: 'relative',
                  outline: 'none',
                }}
              >
                {/* Floating Interactive Tooltip */}
                {isHovered && (
                  <div className="mw-bar-tooltip">
                    <div className="mw-bar-tooltip__date">{point.fullDate}</div>
                    <div className="mw-bar-tooltip__price">
                      ₹{point.price}
                      <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--ink-3)' }}>
                        /hr
                      </span>
                    </div>
                    <div className="mw-bar-tooltip__meta">
                      <span
                        className={`mw-bar-tooltip__badge ${
                          point.status === 'Off-Peak Discount'
                            ? 'mw-bar-tooltip__badge--discount'
                            : point.status === 'Peak Window'
                            ? 'mw-bar-tooltip__badge--peak'
                            : 'mw-bar-tooltip__badge--optimal'
                        }`}
                      >
                        {point.status}
                      </span>
                      <span
                        style={{
                          fontSize: '0.64rem',
                          fontFamily: 'var(--font-mono)',
                          color: delta <= 0 ? 'var(--brand-hi)' : '#f59e0b',
                        }}
                      >
                        {delta > 0 ? `+${deltaPct}%` : `${deltaPct}%`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Animated Bar with highlight cap */}
                <div
                  className="mw-bar"
                  style={{
                    height: `${heightPct}%`,
                    position: 'relative',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div className="mw-bar-cap" />
                </div>

                {/* X-Axis Label */}
                <small
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: isSelected || isHovered ? 'var(--brand-hi)' : 'var(--ink-4)',
                    fontWeight: isSelected || isHovered ? 700 : 500,
                    fontSize: data.length > 10 ? '0.62rem' : '0.7rem',
                  }}
                >
                  {point.label}
                </small>
              </div>
            )
          })}
        </div>

        {/* ── Inspected Window Live Action Strip ───────────────── */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line)',
            background: 'rgba(0, 0, 0, 0.15)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Calendar size={14} style={{ color: 'var(--brand-hi)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink)' }}>
                {activePoint.fullDate}
              </span>
            </div>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <MapPin size={13} style={{ color: 'var(--ink-3)' }} />
              <span style={{ fontSize: '0.76rem', color: 'var(--ink-2)' }}>
                {activePoint.region}
              </span>
            </div>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <CheckCircle2 size={13} style={{ color: 'var(--brand-hi)' }} />
              <span style={{ fontSize: '0.76rem', color: 'var(--ink-2)' }}>
                {activePoint.nodes} Nodes Available
              </span>
            </div>
          </div>

          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86rem', fontWeight: 700, color: 'var(--ink)' }}>
              Spot: <span style={{ color: 'var(--brand-hi)' }}>₹{activePoint.price}/hr</span>
            </span>
            <button
              type="button"
              className="mw-primary"
              style={{ padding: '6px 14px', fontSize: '0.76rem' }}
              onClick={() => navigate('/dashboard/gpus')}
            >
              <span>Deploy {gpu}</span>
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>

        <p className="mw-footnote" style={{ marginTop: 10, paddingBottom: 12 }}>
          Historical prices are aggregated from real-time telemetry across Indian Tier-IV datacenters in Mumbai (ap-south-1), Hyderabad (ap-south-2), and Noida. Spot pricing dynamically adjusts with compute cluster supply.
        </p>
      </div>
    </div>
  )
}
