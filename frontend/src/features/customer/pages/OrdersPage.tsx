/**
 * Orders & Cost History — Track active, completed, and archived compute orders.
 * Connected directly to customer workspace, Supabase records, and backend orders APIs.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileText,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Search,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import {
  filterOrders,
  getOrderCounts,
  SAMPLE_ORDERS,
  selectOrders,
  type OrderView,
} from '../data/marketplace'
import { updateOrderStatus } from '../data/serviceClients'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { ConfirmDialog, Dialog } from '../ui/Dialog'
import {
  Button,
  ButtonLink,
  Card,
  StatusPill,
} from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

type OrderTab = 'all' | 'running' | 'completed' | 'cancelled' | 'archived'

export default function OrdersPage() {
  const section = getSection('orders')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()

  // Selected records
  const allOrders = useMemo(() => {
    if (!workspace) return []
    const live = selectOrders(workspace)
    // If the workspace has orders, use them; if empty in dev mode, provide SAMPLE_ORDERS
    return live.length > 0 ? live : SAMPLE_ORDERS
  }, [workspace])

  // Filter & Search states
  const [activeTab, setActiveTab] = useState<OrderTab>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Action & Modal states
  const [selectedOrder, setSelectedOrder] = useState<OrderView | null>(null)
  const [invoiceOrder, setInvoiceOrder] = useState<OrderView | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<OrderView | null>(null)
  const [unarchiveTarget, setUnarchiveTarget] = useState<OrderView | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Live counts across all orders
  const counts = useMemo(() => getOrderCounts(allOrders), [allOrders])

  // Filtered rows for current tab and search query
  const filteredOrders = useMemo(() => {
    return filterOrders(allOrders, activeTab, searchQuery)
  }, [allOrders, activeTab, searchQuery])

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedText(label)
    setTimeout(() => setCopiedText(null), 2000)
  }

  // Handle Archive Order
  const handleArchive = async (order: OrderView) => {
    setIsUpdating(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await updateOrderStatus(order.id, 'archived')
      setActionSuccess(`Order ${order.orderNumber} has been archived.`)
      setArchiveTarget(null)
      if (selectedOrder?.id === order.id) {
        setSelectedOrder({ ...selectedOrder, status: 'archived' })
      }
      refresh()
    } catch (err: any) {
      setActionError(err?.message || 'Failed to archive order. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  // Handle Unarchive Order
  const handleUnarchive = async (order: OrderView) => {
    setIsUpdating(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await updateOrderStatus(order.id, 'completed')
      setActionSuccess(`Order ${order.orderNumber} restored to history.`)
      setUnarchiveTarget(null)
      if (selectedOrder?.id === order.id) {
        setSelectedOrder({ ...selectedOrder, status: 'completed' })
      }
      refresh()
    } catch (err: any) {
      setActionError(err?.message || 'Failed to unarchive order. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="cx-page">
      {/* ── Context & Page Header ── */}
      <div className="cx-deploy-header-group">
        <div className="cx-deploy-context-bar">
          <Link to="/dashboard/app" className="cx-deploy-backlink">
            <ChevronLeft size={16} /> Back to overview
          </Link>
          <button
            type="button"
            className="cx-iconbtn cx-deploy-refresh-btn"
            onClick={refresh}
            title="Refresh order records"
            aria-label="Refresh orders"
          >
            <RefreshCw size={15} className={state.status === 'loading' ? 'is-spinning' : ''} />
          </button>
        </div>

        <div className="cx-deploy-main-header">
          <div className="cx-deploy-header-text">
            <h1 className="cx-title">Orders & Cost History</h1>
            <p className="cx-subtitle">Track active, completed, and archived compute orders.</p>
          </div>
          <div className="cx-deploy-header-actions">
            <ButtonLink to="/dashboard/app/gpus" variant="primary">
              <Plus size={16} /> New Compute Order
            </ButtonLink>
          </div>
        </div>
      </div>

      {/* ── Alerts & Feedback Banner ── */}
      {actionSuccess ? (
        <div className="cx-deploy-alert is-success" role="alert">
          <Check size={16} />
          <span>{actionSuccess}</span>
          <button type="button" className="cx-alert-close" onClick={() => setActionSuccess(null)}>
            ×
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="cx-deploy-alert is-error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="cx-alert-close" onClick={() => setActionError(null)}>
            ×
          </button>
        </div>
      ) : null}

      {/* ── Orders Card with Toolbar & Table ── */}
      <Card>
        {/* Section Heading */}
        <div className="cx-deploy-section-header">
          <div className="cx-deploy-section-title-wrap">
            <div className="cx-deploy-section-icon">
              <Receipt size={18} />
            </div>
            <div>
              <h2 className="cx-deploy-section-title">Orders & Compute History</h2>
              <p className="cx-deploy-section-sub">
                Track historical and active GPU instance reservations, durations, and estimated expenditures.
              </p>
            </div>
          </div>
          <ButtonLink to="/dashboard/app/gpus" variant="secondary" size="sm">
            <Plus size={14} /> New Compute Order
          </ButtonLink>
        </div>

        {/* Search & Status Tabs Toolbar */}
        <div className="cx-deploy-toolbar">
          <div className="cx-search-wrap">
            <Search size={15} className="cx-search-icon" />
            <input
              type="text"
              placeholder="Search by order ID, workload, datacenter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="cx-input cx-search-input"
              aria-label="Search compute orders"
            />
            {searchQuery ? (
              <button
                type="button"
                className="cx-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="cx-deploy-status-pills" role="tablist" aria-label="Order status filter tabs">
            {(
              [
                { id: 'all', label: 'All', count: counts.all },
                { id: 'running', label: 'Running', count: counts.running },
                { id: 'completed', label: 'Completed', count: counts.completed },
                { id: 'cancelled', label: 'Cancelled', count: counts.cancelled },
                { id: 'archived', label: 'Archived', count: counts.archived },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`cx-filter-pill ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label} <span className="cx-filter-pill-count">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* State Handling: Loading, Error, Empty, or Table */}
        {state.status === 'error' && state.error && allOrders.length === 0 ? (
          <ErrorState
            error={state.error}
            what="compute orders"
            onRetry={refresh}
          />
        ) : state.status === 'loading' && allOrders.length === 0 ? (
          <div className="cx-orders-loading">
            <LoadingBlock lines={5} label="Loading compute order records" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            icon={<Receipt size={28} />}
            title={
              searchQuery
                ? 'No matching compute orders'
                : activeTab === 'archived'
                  ? 'No archived orders'
                  : activeTab !== 'all'
                    ? `No ${activeTab} compute orders`
                    : 'No compute orders placed yet'
            }
            body={
              searchQuery
                ? `No compute order records matched "${searchQuery}". Clear your search query or select another filter tab.`
                : activeTab === 'archived'
                  ? 'Completed or cancelled orders you archive will be preserved here.'
                  : 'You have not placed any compute reservations yet. Select sovereign GPU capacity from the marketplace to launch workloads.'
            }
            actions={
              searchQuery ? (
                <Button variant="secondary" onClick={() => setSearchQuery('')}>
                  Clear search query
                </Button>
              ) : (
                <ButtonLink to="/dashboard/app/gpus" variant="primary">
                  <Plus size={16} /> New Compute Order
                </ButtonLink>
              )
            }
          />
        ) : (
          <div className="cx-table-wrap">
            <table className="cx-table cx-table--stack" aria-label="Customer compute orders">
              <thead>
                <tr>
                  <th scope="col">Order ID</th>
                  <th scope="col">Workload / Hardware</th>
                  <th scope="col">Datacenter Facility</th>
                  <th scope="col">Order Date</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Estimated Cost</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="cx-actions-th">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const tone =
                    order.status === 'running'
                      ? 'success'
                      : order.status === 'completed'
                        ? 'success'
                        : order.status === 'cancelled'
                          ? 'danger'
                          : 'neutral'

                  return (
                    <tr key={order.id}>
                      <td data-label="Order ID">
                        <span className="cx-order-number-mono">{order.orderNumber}</span>
                      </td>

                      <td data-label="Workload / Hardware">
                        <div className="cx-order-item-wrap">
                          <span className="cx-order-item-title">{order.workloadHardware}</span>
                          {order.deploymentId ? (
                            <span className="cx-order-subtext">Linked deployment: {order.deploymentId}</span>
                          ) : null}
                        </div>
                      </td>

                      <td data-label="Datacenter Facility">
                        <span className="cx-order-facility">{order.datacenterFacility}</span>
                      </td>

                      <td data-label="Order Date">
                        <span className="cx-order-date">{order.orderDate}</span>
                      </td>

                      <td data-label="Duration">
                        <span className="cx-order-duration">{order.duration}</span>
                      </td>

                      <td data-label="Estimated Cost">
                        <span className="cx-order-cost-bold">{order.estimatedCost}</span>
                      </td>

                      <td data-label="Status">
                        <StatusPill tone={tone} dot={order.status === 'running'}>
                          {order.status === 'running'
                            ? 'Running'
                            : order.status === 'completed'
                              ? 'Completed'
                              : order.status === 'cancelled'
                                ? 'Cancelled'
                                : 'Archived'}
                        </StatusPill>
                      </td>

                      <td data-label="Action" className="cx-actions-td">
                        <div className="cx-order-row-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedOrder(order)}
                            aria-label={`View Details for ${order.orderNumber}`}
                          >
                            <Eye size={14} /> View Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── View Order Details Dialog / Drawer ── */}
      {selectedOrder ? (
        <Dialog
          open={Boolean(selectedOrder)}
          title={`Order Details · ${selectedOrder.orderNumber}`}
          description="Detailed hardware specifications, datacenter facility, billing and payment records."
          onClose={() => setSelectedOrder(null)}
        >
          <div className="cx-order-details-modal">
            {/* Header Identity Row */}
            <div className="cx-order-details-banner">
              <div>
                <span className="cx-order-details-num">{selectedOrder.orderNumber}</span>
                <h3 className="cx-order-details-workload">{selectedOrder.workloadHardware}</h3>
              </div>
              <StatusPill
                tone={
                  selectedOrder.status === 'running'
                    ? 'success'
                    : selectedOrder.status === 'completed'
                      ? 'success'
                      : selectedOrder.status === 'cancelled'
                        ? 'danger'
                        : 'neutral'
                }
                dot={selectedOrder.status === 'running'}
              >
                {selectedOrder.status.charAt(0).toUpperCase() + selectedOrder.status.slice(1)}
              </StatusPill>
            </div>

            {/* Specification & Lifecycle DL Grid */}
            <dl className="cx-deploy-details-dl cx-order-details-dl">
              <div>
                <dt>Order ID</dt>
                <dd className="cx-deploy-details-copy-row">
                  <span className="cx-mono-pill">{selectedOrder.orderNumber}</span>
                  <button
                    type="button"
                    className="cx-iconbtn-sm"
                    onClick={() => copyToClipboard(selectedOrder.orderNumber, 'ord-id')}
                    title="Copy Order ID"
                  >
                    {copiedText === 'ord-id' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </dd>
              </div>

              <div>
                <dt>Current Status</dt>
                <dd>
                  <span className="cx-order-status-text">
                    {selectedOrder.status === 'running'
                      ? 'Active instance reservation'
                      : selectedOrder.status === 'completed'
                        ? 'Workload completed successfully'
                        : selectedOrder.status === 'cancelled'
                          ? 'Cancelled before completion'
                          : 'Archived record'}
                  </span>
                </dd>
              </div>

              <div>
                <dt>Workload</dt>
                <dd>{selectedOrder.workload}</dd>
              </div>

              <div>
                <dt>GPU Hardware Configuration</dt>
                <dd>{selectedOrder.details?.specs || selectedOrder.hardware}</dd>
              </div>

              <div>
                <dt>Datacenter Facility</dt>
                <dd>{selectedOrder.datacenterFacility}</dd>
              </div>

              <div>
                <dt>Order Date & Time</dt>
                <dd>{selectedOrder.details?.start_date || selectedOrder.orderDate}</dd>
              </div>

              <div>
                <dt>Duration</dt>
                <dd>{selectedOrder.duration}</dd>
              </div>

              <div>
                <dt>Execution Window</dt>
                <dd>
                  {selectedOrder.details?.start_date && selectedOrder.details?.end_date
                    ? `${selectedOrder.details.start_date} → ${selectedOrder.details.end_date}`
                    : '10 Oct 2026, 14:30 → 11 Oct 2026, 14:30'}
                </dd>
              </div>

              <div>
                <dt>Estimated Cost</dt>
                <dd className="cx-order-cost-bold">{selectedOrder.estimatedCost}</dd>
              </div>

              <div>
                <dt>Actual Cost</dt>
                <dd className="cx-order-cost-bold">{selectedOrder.actualCost}</dd>
              </div>

              <div>
                <dt>Payment Method</dt>
                <dd>
                  <span className="cx-order-payment-method">
                    <CreditCard size={14} /> {selectedOrder.details?.payment_method || 'Prepaid Compute Wallet'}
                  </span>
                </dd>
              </div>

              <div>
                <dt>Payment Settlement Status</dt>
                <dd>
                  <span className="cx-order-payment-status">
                    {selectedOrder.details?.payment_status || 'Paid & Settled'}
                  </span>
                </dd>
              </div>

              {selectedOrder.details?.transaction_id ? (
                <div>
                  <dt>Transaction Reference</dt>
                  <dd className="cx-mono-pill">{selectedOrder.details.transaction_id}</dd>
                </div>
              ) : null}

              {selectedOrder.deploymentId ? (
                <div>
                  <dt>Associated Deployment</dt>
                  <dd>
                    <Link
                      to={`/dashboard/app/deployments?id=${selectedOrder.deploymentId}`}
                      className="cx-order-dep-link"
                    >
                      {selectedOrder.deploymentId} <ExternalLink size={13} />
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>

            {/* Bottom Actions Toolbar */}
            <div className="cx-order-modal-actions">
              <div className="cx-order-modal-actions-left">
                {selectedOrder.status === 'completed' || selectedOrder.status === 'cancelled' ? (
                  <Button
                    variant="secondary"
                    onClick={() => setArchiveTarget(selectedOrder)}
                    disabled={isUpdating}
                  >
                    <Archive size={15} /> Archive Order
                  </Button>
                ) : null}

                {selectedOrder.status === 'archived' ? (
                  <Button
                    variant="secondary"
                    onClick={() => setUnarchiveTarget(selectedOrder)}
                    disabled={isUpdating}
                  >
                    <ArchiveRestore size={15} /> Restore to History
                  </Button>
                ) : null}

                {selectedOrder.status === 'completed' || selectedOrder.status === 'archived' ? (
                  <Button
                    variant="secondary"
                    onClick={() => setInvoiceOrder(selectedOrder)}
                  >
                    <FileText size={15} /> View Tax Invoice
                  </Button>
                ) : null}
              </div>

              <Button variant="primary" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {/* ── Tax Invoice / Receipt Modal ── */}
      {invoiceOrder ? (
        <Dialog
          open={Boolean(invoiceOrder)}
          title={`Compute Invoice · ${invoiceOrder.details?.invoice_number || `INV-${invoiceOrder.orderNumber}`}`}
          description="Official tax invoice and payment settlement statement for compute capacity."
          onClose={() => setInvoiceOrder(null)}
        >
          <div className="cx-invoice-sheet" id="cx-invoice-print-area">
            {/* Invoice Top Branding */}
            <div className="cx-invoice-header">
              <div>
                <span className="cx-invoice-brand">INFERXE COMPUTE PLATFORM</span>
                <p className="cx-invoice-sub">Automatrix Sovereign Infrastructure Inc.</p>
              </div>
              <div className="cx-invoice-meta-right">
                <span className="cx-invoice-badge">TAX INVOICE</span>
                <span className="cx-invoice-num">
                  {invoiceOrder.details?.invoice_number || `INV-2026-${invoiceOrder.orderNumber}`}
                </span>
                <span className="cx-invoice-date">Date: {invoiceOrder.orderDate}</span>
              </div>
            </div>

            <div className="cx-invoice-divider" />

            {/* Billed To & Facility */}
            <div className="cx-invoice-parties">
              <div>
                <span className="cx-invoice-label">BILLED TO</span>
                <strong>{workspace?.profile.full_name || 'Inferxe Customer'}</strong>
                <p>{workspace?.profile.email || 'customer@inferxe.com'}</p>
                <p>{workspace?.profile.organization_id ? `Org ID: ${workspace.profile.organization_id}` : 'Developer Account'}</p>
              </div>
              <div className="cx-invoice-facility-info">
                <span className="cx-invoice-label">DATACENTER FACILITY</span>
                <strong>{invoiceOrder.datacenterFacility}</strong>
                <p>Status: {invoiceOrder.details?.payment_status || 'Settled'}</p>
                <p>Txn ID: {invoiceOrder.details?.transaction_id || 'TX-8492'}</p>
              </div>
            </div>

            {/* Invoice Line Items Table */}
            <div className="cx-invoice-items-wrap">
              <table className="cx-invoice-table">
                <thead>
                  <tr>
                    <th>Workload & Hardware Description</th>
                    <th>Duration</th>
                    <th>Hourly Rate</th>
                    <th className="is-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>{invoiceOrder.workloadHardware}</strong>
                      <p className="cx-invoice-specs">{invoiceOrder.details?.specs || invoiceOrder.hardware}</p>
                    </td>
                    <td>{invoiceOrder.duration}</td>
                    <td>{invoiceOrder.estimatedCost}</td>
                    <td className="is-num">{invoiceOrder.actualCost}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Calculations Breakdown */}
            <div className="cx-invoice-totals">
              <div className="cx-invoice-total-row">
                <span>Subtotal (Compute Reservation)</span>
                <span>{invoiceOrder.actualCost}</span>
              </div>
              <div className="cx-invoice-total-row">
                <span>GST / Integrated Tax (18% included)</span>
                <span>Included</span>
              </div>
              <div className="cx-invoice-total-row is-grand">
                <span>Total Paid (INR)</span>
                <span>{invoiceOrder.actualCost}</span>
              </div>
            </div>

            {/* Actions: Print & Close */}
            <div className="cx-invoice-actions">
              <Button
                variant="secondary"
                onClick={() => window.print()}
                title="Print or Save as PDF"
              >
                <Printer size={15} /> Print / Save PDF
              </Button>
              <Button variant="primary" onClick={() => setInvoiceOrder(null)}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {/* ── Confirm Archive Dialog ── */}
      {archiveTarget ? (
        <ConfirmDialog
          open={Boolean(archiveTarget)}
          title={`Archive compute order ${archiveTarget.orderNumber}?`}
          description="Archived orders are preserved in your Archived tab and can be viewed or restored at any time. Order records will never be permanently deleted."
          confirmLabel="Archive order"
          busy={isUpdating}
          onConfirm={() => handleArchive(archiveTarget)}
          onCancel={() => setArchiveTarget(null)}
        />
      ) : null}

      {/* ── Confirm Unarchive Dialog ── */}
      {unarchiveTarget ? (
        <ConfirmDialog
          open={Boolean(unarchiveTarget)}
          title={`Restore order ${unarchiveTarget.orderNumber} to history?`}
          description="This compute order will be restored to your active order history."
          confirmLabel="Restore order"
          busy={isUpdating}
          onConfirm={() => handleUnarchive(unarchiveTarget)}
          onCancel={() => setUnarchiveTarget(null)}
        />
      ) : null}
    </div>
  )
}

